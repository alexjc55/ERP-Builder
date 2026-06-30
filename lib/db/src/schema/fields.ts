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
 * (server upload only). `driveFolderId` is the Google Drive folder id (one of
 * the managed folders) that `gdrive` uploads for this field land in; unset means
 * the connection's default folder.
 */
export type FileFieldConfig = { allowedSources?: FileSource[]; driveFolderId?: string };

/**
 * Per-field configuration for a `user`-type field. `allowedRoleIds` restricts the
 * selectable users to those roles. Empty/unset means any user may be selected.
 */
export type UserFieldConfig = { allowedRoleIds?: number[]; allowCreate?: boolean };

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

/** Comparison used by a cross-field validation (fill) rule. */
export type ValidationOperator =
  | "empty"
  | "notEmpty"
  | "equals"
  | "notEquals"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "between";

/**
 * One cross-field validation ("fill") rule. Distinct from conditional
 * formatting (which is purely cosmetic): this is a HARD constraint on saving.
 * Saving THIS field with a value — any non-empty value, or one of
 * `applyToValues` when that list is non-empty — is allowed only when the field
 * named `conditionFieldKey` (same entity) satisfies `operator`/`value`
 * (`value2` is the upper bound for `between`). Otherwise the record
 * create/update is rejected server-side with an auto-generated message. Rules
 * are evaluated against the FINAL merged record values.
 */
export type FieldValidationRule = {
  applyToValues?: string[];
  conditionFieldKey: string;
  operator: ValidationOperator;
  value?: string;
  value2?: string;
};

/**
 * Per-field configuration for a `function`-type field. `expression` is a safe
 * formula referencing other fields of the same record via `{field_key}`. It is
 * evaluated at read time (never stored) by a sandboxed evaluator.
 */
export type FormulaFieldConfig = { expression?: string };

/**
 * Per-field configuration for a dependent ("cascading") field. When
 * `dependsOnFieldKey` is set, this field's value picker is gated on the parent
 * field: it stays disabled until the parent has a value, and its option list is
 * the distinct existing values of THIS field among records whose parent-chain
 * matches the current row. Used for Variant-A string suggestions (e.g.
 * Client → Project → Order number). Empty/unset means no dependency.
 */
export type DependencyFieldConfig = { dependsOnFieldKey?: string; relatedFilterFieldKey?: string };

/**
 * Per-field configuration for a `relation`-type field. The column surfaces one
 * field (`relatedFieldKey`) of a single linked record, resolved through a
 * qualifying single-link relation (`relationId`). The value is derived from the
 * linked record (never stored in `valuesJson`); assigning/clearing the link
 * writes a row in `record_links`. Shared by entity fields and page fields.
 */
export type RelationFieldConfig = {
  relationId?: number | null;
  relatedFieldKey?: string | null;
  writeThrough?: boolean;
  // Lookup-only: project a PAGE-LOCAL field (page_record_values) of the linked
  // record instead of one of its entity fields. Null/absent = project an entity
  // field. Page-source lookups are read-only (never writeThrough).
  relatedPageId?: number | null;
};

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
    // Cross-field validation (fill) rules — hard constraint on record save,
    // distinct from the cosmetic formatRulesJson. Empty [] = no constraints.
    validationRulesJson: jsonb("validation_rules_json").$type<FieldValidationRule[]>().notNull().default([]),
    formulaConfigJson: jsonb("formula_config_json").$type<FormulaFieldConfig>().notNull().default({}),
    dependencyConfigJson: jsonb("dependency_config_json").$type<DependencyFieldConfig>().notNull().default({}),
    // Per-field config for a `relation`-type entity field (the relation it binds to
    // and which target field to display). Empty {} for non-relation fields.
    relationConfigJson: jsonb("relation_config_json").$type<RelationFieldConfig>().notNull().default({}),
    // Value must be unique within the entity (case-insensitive). Enforced server-side
    // on record create/update; meaningless for file/function types (rejected at field CRUD).
    isKey: boolean("is_key").notNull().default(false),
    // Value is immutable once a non-empty value has been saved (hard server boundary,
    // no superAdmin exception). Used e.g. to make an order's Project unchangeable.
    lockAfterCreate: boolean("lock_after_create").notNull().default(false),
    isFilterable: boolean("is_filterable").notNull().default(false),
    // Opt-in: this field may be used as a pivot (Сводная таблица) dimension/measure.
    // Restricts what appears in the pivot builder so not every field is exposed.
    pivotEnabled: boolean("pivot_enabled").notNull().default(false),
    showInTable: boolean("show_in_table").notNull().default(true),
    isPinned: boolean("is_pinned").notNull().default(false),
    showColumnTotal: boolean("show_column_total").notNull().default(false),
    // When true, long values in this column wrap onto multiple lines instead of
    // being truncated with an ellipsis. Cosmetic, table-rendering only.
    wrapText: boolean("wrap_text").notNull().default(false),
    totalFillColor: text("total_fill_color"),
    totalTextColor: text("total_text_color"),
    // Base column-group membership (points at column_groups.id). Inherited
    // everywhere the field is shown, including mirror pages, where it may be
    // overridden via pages.columnGroupsJson. Plain int (no FK): a removed group
    // simply stops rendering (soft delete, no cascade).
    columnGroupId: integer("column_group_id"),
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
