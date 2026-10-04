import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { pagesTable } from "./pages";

const ml = z.object({ ru: z.string().max(10000).optional(), en: z.string().max(10000).optional(), he: z.string().max(10000).optional() });
const cardLink = z.string().max(2048).refine(value => {
  if (value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (value.startsWith("#")) return /^#[A-Za-z0-9][A-Za-z0-9\-_.:]{0,254}$/.test(value);
  try {
    const url = new URL(value);
    return ((url.protocol === "https:" || url.protocol === "http:") && /^https?:\/\//i.test(value) && !!url.hostname)
      || (url.protocol === "mailto:" && url.pathname.includes("@"));
  } catch { return false; }
}, "Use an HTTP(S), mailto or #anchor link");
const textRun = z.object({
  text: z.string().max(10000),
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  link: cardLink.optional(),
});
const textRuns = z.array(textRun).max(500).refine(runs => runs.reduce((sum, run) => sum + run.text.length, 0) <= 10000, "Text is too long");
const block = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(["field", "text", "divider", "relatedTable"]),
  fieldKey: z.string().max(200).nullable().optional(),
  label: ml.optional(),
  text: ml.optional(),
  textRuns: z.object({ ru: textRuns.optional(), en: textRuns.optional(), he: textRuns.optional() }).optional(),
  textStyle: z.object({
    bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    direction: z.enum(["auto", "ltr", "rtl"]).optional(),
    align: z.enum(["start", "center", "end", "left", "right", "justify"]).optional(),
    link: cardLink.optional(),
  }).optional(),
  dividerStyle: z.object({
    kind: z.enum(["space", "solid", "dashed", "dotted"]).optional(),
    thickness: z.number().int().min(1).max(12).optional(),
    height: z.number().int().min(0).max(400).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).optional(),
  span: z.number().int().min(1).max(3).default(1),
  modes: z.array(z.enum(["view", "create", "edit"])).min(1).default(["view", "create", "edit"]),
  columns: z.array(z.string().max(200)).max(30).default([]),
}).superRefine((block, ctx) => {
  for (const lang of ["ru", "en", "he"] as const) {
    const runs = block.textRuns?.[lang];
    if (runs && runs.map(run => run.text).join("") !== (block.text?.[lang] ?? "")) {
      ctx.addIssue({ code: "custom", path: ["textRuns", lang], message: "Formatted text must match the plain text for this language" });
    }
  }
});
const section = z.object({
  id: z.string().min(1).max(100), title: ml,
  columns: z.number().int().min(1).max(3),
  blocks: z.array(block).max(100),
  // Additive: absence retains the legacy auto-flow grid without rewriting it.
  rows: z.array(z.object({
    id: z.string().min(1).max(100),
    columns: z.number().int().min(1).max(3),
    blockIds: z.array(z.string().min(1).max(100)).max(100),
  })).max(100).optional(),
}).superRefine((section, ctx) => {
  if (!section.rows) return;
  const known = new Set(section.blocks.map(b => b.id));
  const used = new Set<string>();
  if (known.size !== section.blocks.length) {
    ctx.addIssue({ code: "custom", path: ["blocks"], message: "Block IDs must be unique within a section" });
  }
  for (const [rowIndex, row] of section.rows.entries()) {
    for (const [blockIndex, id] of row.blockIds.entries()) {
      if (!known.has(id) || used.has(id)) {
        ctx.addIssue({ code: "custom", path: ["rows", rowIndex, "blockIds", blockIndex], message: "Each row must reference distinct blocks from its section" });
      }
      used.add(id);
    }
  }
  if (section.blocks.some(b => !used.has(b.id))) {
    ctx.addIssue({ code: "custom", path: ["rows"], message: "Every section block must belong to exactly one row" });
  }
});
export const cardLayoutSchema = z.object({
  version: z.literal(1),
  style: z.enum(["standard", "compact", "sectioned", "custom"]).default("standard"),
  customStyle: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    sectionBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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