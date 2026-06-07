import { pgTable, serial, jsonb, text, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

/** Per-field access level for a role. Unset role inherits the role's record perms. */
export type FieldAccess = "hidden" | "view" | "edit";

/** Field-level permission map: stringified roleId -> access level. */
export type FieldPermissions = Record<string, FieldAccess>;

/** A source a `file`-type field value may come from. */
export type FileSource = "server" | "gdrive" | "link";

/**
 * Per-field configuration for a `file`-type field. `allowedSources` lists which
 * fill-time sources are offered/accepted. Empty/unset means the legacy default
 * (server upload only).
 */
export type FileFieldConfig = { allowedSources?: FileSource[] };

/**
 * Per-field configuration for a `user`-type field. `allowedRoleIds` restricts the
 * selectable users to those roles. Empty/unset means any user may be selected.
 */
export type UserFieldConfig = { allowedRoleIds?: number[] };

/** Comparison used by a conditional-formatting rule. */
export type FormatOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "empty"
  | "notEmpty"
  | "gt"
  | "lt"
  | "gte"
  | "lte";

/**
 * One conditional-formatting rule. When the cell value matches `operator`/`value`
 * the cell is painted `cellColor` and/or the whole row `rowColor`, and the cell
 * text is painted `textColor` (all hex strings). Rules are evaluated in order;
 * the first match wins per field. Cell colors take precedence over row colors on
 * the same cell.
 */
export type FieldFormatRule = {
  operator: FormatOperator;
  value?: string;
  cellColor?: string;
  rowColor?: string;
  textColor?: string;
};

/**
 * Per-field configuration for a `function`-type field. `expression` is a safe
 * formula referencing other fields of the same record via `{field_key}`. It is
 * evaluated at read time (never stored) by a sandboxed evaluator.
 */
export type FormulaFieldConfig = { expression?: string };

export const entityFieldsTable = pgTable(
  "entity_fields",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    nameJson: jsonb("name_json").notNull().default({}),
    descriptionJson: jsonb("description_json").default({}),
    fieldType: text("field_type").notNull().default("text"),
    isRequired: boolean("is_required").notNull().default(false),
    defaultValue: text("default_value"),
    optionsJson: jsonb("options_json").notNull().default([]),
    permissionsJson: jsonb("permissions_json").$type<FieldPermissions>().notNull().default({}),
    fileConfigJson: jsonb("file_config_json").$type<FileFieldConfig>().notNull().default({}),
    userConfigJson: jsonb("user_config_json").$type<UserFieldConfig>().notNull().default({}),
    formatRulesJson: jsonb("format_rules_json").$type<FieldFormatRule[]>().notNull().default([]),
    formulaConfigJson: jsonb("formula_config_json").$type<FormulaFieldConfig>().notNull().default({}),
    isFilterable: boolean("is_filterable").notNull().default(false),
    showInTable: boolean("show_in_table").notNull().default(true),
    showColumnTotal: boolean("show_column_total").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("entity_field_key_unique").on(t.entityId, t.fieldKey)],
);

export const insertEntityFieldSchema = createInsertSchema(entityFieldsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntityField = z.infer<typeof insertEntityFieldSchema>;
export type EntityField = typeof entityFieldsTable.$inferSelect;
