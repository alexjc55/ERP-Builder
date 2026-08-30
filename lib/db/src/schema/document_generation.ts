import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { usersTable } from "./users";

export const DOCUMENT_GENERATION_MODULE_KEY = "document_generation";

export const documentValueMappingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("field"), fieldKey: z.string().min(1) }),
  z.object({ source: z.literal("page"), pageId: z.number().int().positive(), fieldKey: z.string().min(1) }),
  z.object({ source: z.literal("status") }),
  z.object({ source: z.literal("system"), key: z.enum(["record_id", "created_at", "generated_at"]) }),
  z.object({ source: z.literal("literal"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ source: z.literal("blank") }),
]);

export const documentCollectionMappingSchema = z.object({
  relationFieldKey: z.string().min(1),
  filters: z.array(z.object({
    fieldKey: z.string().min(1),
    operator: z.enum(["eq", "neq", "contains", "empty", "notEmpty"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }).superRefine((v, ctx) => {
    if (!["empty", "notEmpty"].includes(v.operator) && v.value === undefined)
      ctx.addIssue({ code: "custom", message: "value is required for this operator" });
  })).max(12).default([]),
  sort: z.array(z.object({
    fieldKey: z.string().min(1),
    direction: z.enum(["asc", "desc"]).default("asc"),
  })).max(4).default([]),
  fields: z.record(z.string(), documentValueMappingSchema),
});

export const documentMappingSchema = z.object({
  scalars: z.record(z.string(), documentValueMappingSchema).default({}),
  collections: z.record(z.string(), documentCollectionMappingSchema).default({}),
});
export type DocumentMapping = z.infer<typeof documentMappingSchema>;

const nonBlank = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0, "value cannot be blank");
const documentFilenameAltSchema = z.object({
  fieldKey: nonBlank(160),
  label: z.string().max(240).optional(),
}).strict();
const documentFilenameSectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: nonBlank(120) }).strict(),
  z.object({
    kind: z.literal("field"),
    fieldKey: nonBlank(160),
    label: z.string().max(240).optional(),
    alts: z.array(documentFilenameAltSchema).max(20).optional(),
  }).strict(),
  z.object({ kind: z.literal("hash") }).strict(),
  z.object({ kind: z.literal("date") }).strict(),
  z.object({ kind: z.literal("user") }).strict(),
]);
const documentFilenameTemplateSchema = z.object({
  sections: z.array(documentFilenameSectionSchema).min(1).max(20),
}).strict();

export const documentGenerationOutputSchema = z.discriminatedUnion("destination", [
  z.object({
    outputFormat: z.enum(["docx", "pdf"]),
    destination: z.literal("local"),
    localFolderId: z.number().int().positive(),
    targetFileFieldKey: z.string().min(1),
    filenameTemplate: z.union([z.string().min(1).max(180), documentFilenameTemplateSchema]),
    overwrite: z.enum(["replace", "error"]),
  }),
  z.object({
    outputFormat: z.enum(["docx", "pdf"]),
    destination: z.literal("gdrive"),
    driveFolderId: z.string().min(1),
    targetFileFieldKey: z.string().min(1),
    filenameTemplate: z.union([z.string().min(1).max(180), documentFilenameTemplateSchema]),
    overwrite: z.enum(["replace", "error"]),
  }),
]);
export type DocumentGenerationOutput = z.infer<typeof documentGenerationOutputSchema>;

export const documentTemplatesTable = pgTable("document_templates", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("document_template_entity_idx").on(t.entityId)]);

export const documentTemplateRevisionsTable = pgTable("document_template_revisions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => documentTemplatesTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  state: text("state").notNull().default("draft"),
  templatePath: text("template_path").notNull(),
  templateName: text("template_name").notNull(),
  manifestJson: jsonb("manifest_json").notNull().default({}),
  mappingJson: jsonb("mapping_json").notNull().default({}),
  errorsJson: jsonb("errors_json").notNull().default([]),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("document_revision_number_unique").on(t.templateId, t.revision),
  index("document_revision_template_idx").on(t.templateId),
]);

export const documentGenerationRunsTable = pgTable("document_generation_runs", {
  id: serial("id").primaryKey(),
  revisionId: integer("revision_id").notNull().references(() => documentTemplateRevisionsTable.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  status: text("status").notNull(),
  outputJson: jsonb("output_json"),
  error: text("error"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("document_generation_run_revision_idx").on(t.revisionId),
  uniqueIndex("document_generation_run_idempotency_unique").on(t.revisionId, t.recordId, t.idempotencyKey),
]);

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentTemplateRevisionSchema = createInsertSchema(documentTemplateRevisionsTable).omit({ id: true, createdAt: true });
export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;
export type DocumentTemplateRevision = typeof documentTemplateRevisionsTable.$inferSelect;
export type DocumentGenerationRun = typeof documentGenerationRunsTable.$inferSelect;
