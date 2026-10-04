import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { pagesTable } from "./pages";

const ml = z.object({ ru: z.string().max(10000).optional(), en: z.string().max(10000).optional(), he: z.string().max(10000).optional() });
const block = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(["field", "text", "divider", "relatedTable"]),
  fieldKey: z.string().max(200).nullable().optional(),
  label: ml.optional(),
  text: ml.optional(),
  span: z.number().int().min(1).max(3).default(1),
  modes: z.array(z.enum(["view", "create", "edit"])).min(1).default(["view", "create", "edit"]),
  columns: z.array(z.string().max(200)).max(30).default([]),
});
const section = z.object({
  id: z.string().min(1).max(100), title: ml,
  columns: z.number().int().min(1).max(3),
  blocks: z.array(block).max(100),
});
export const cardLayoutSchema = z.object({
  version: z.literal(1),
  style: z.enum(["standard", "compact", "sectioned", "custom"]).default("standard"),
  customStyle: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    sectionBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    spacing: z.number().int().min(4).max(32).optional(),
    radius: z.number().int().min(0).max(24).optional(),
    fontSize: z.number().int().min(12).max(20).optional(),
    border: z.boolean().optional(), shadow: z.boolean().optional(),
  }).default({}),
  tabs: z.array(z.object({ id: z.string().min(1).max(100), title: ml, sections: z.array(section).max(30) })).min(1).max(20),
});
export type CardLayout = z.infer<typeof cardLayoutSchema>;
export const cardTemplatesTable = pgTable("card_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  pageId: integer("page_id").references(() => pagesTable.id, { onDelete: "cascade" }),
  state: text("state").$type<"draft" | "published">().notNull().default("draft"),
  layout: jsonb("layout").$type<CardLayout>().notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("card_templates_one_published_entity").on(t.entityId).where(sql`${t.state} = 'published' AND ${t.pageId} IS NULL`),
  uniqueIndex("card_templates_one_published_page").on(t.pageId).where(sql`${t.state} = 'published' AND ${t.pageId} IS NOT NULL`),
]);
export const cardTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  entityId: z.number().int().positive(),
  pageId: z.number().int().positive().nullable().default(null),
  layout: cardLayoutSchema,
  expectedRevision: z.number().int().positive().optional(),
});