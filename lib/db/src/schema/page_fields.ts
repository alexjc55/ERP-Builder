import { pgTable, serial, jsonb, text, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";
import type { FieldFormatRule, FormulaFieldConfig, FieldPermissions } from "./fields";

/**
 * Per-field configuration for a `relation`-type page field. The column surfaces a
 * single field of a RELATED entity's record, resolved through a qualifying
 * single-link relation (source side of 1:1/N:1, or target side of 1:1/1:N).
 * The value is derived (never stored in `page_record_values`); edits write back
 * to the linked record through the normal records-update path.
 */
export type RelationFieldConfig = { relationId?: number | null; relatedFieldKey?: string | null };

/**
 * Page-local field definitions. A mirror page shows another entity's records,
 * but admins can attach extra columns that exist *only on that page* — they do
 * not touch the source entity's schema. Their values live in
 * `page_record_values`, keyed by (pageId, recordId), keeping them isolated from
 * the mirrored entity's own data.
 */
export const pageFieldsTable = pgTable(
  "page_fields",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    nameJson: jsonb("name_json").notNull().default({}),
    descriptionJson: jsonb("description_json").default({}),
    fieldType: text("field_type").notNull().default("text"),
    isRequired: boolean("is_required").notNull().default(false),
    defaultValue: text("default_value"),
    optionsJson: jsonb("options_json").notNull().default([]),
    formatRulesJson: jsonb("format_rules_json").$type<FieldFormatRule[]>().notNull().default([]),
    formulaConfigJson: jsonb("formula_config_json").$type<FormulaFieldConfig>().notNull().default({}),
    relationConfigJson: jsonb("relation_config_json").$type<RelationFieldConfig>().notNull().default({}),
    permissionsJson: jsonb("permissions_json").$type<FieldPermissions>().notNull().default({}),
    showInTable: boolean("show_in_table").notNull().default(true),
    showColumnTotal: boolean("show_column_total").notNull().default(false),
    totalFillColor: text("total_fill_color"),
    totalTextColor: text("total_text_color"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("page_field_key_unique").on(t.pageId, t.fieldKey)],
);

export const insertPageFieldSchema = createInsertSchema(pageFieldsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPageField = z.infer<typeof insertPageFieldSchema>;
export type PageField = typeof pageFieldsTable.$inferSelect;
