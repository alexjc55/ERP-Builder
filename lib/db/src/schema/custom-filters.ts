import { pgTable, serial, jsonb, integer, boolean, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

/**
 * Кастомные фильтры сущности — per-entity CUSTOM FILTERS, structured like
 * Automations (a row per filter, keyed by entity). Each filter renders as ONE
 * chip on the records filter bar and narrows the TABLE, PIVOT (сводная) and
 * CALENDAR views of that entity.
 *
 * A filter is a two-level boolean tree: a list of GROUPS combined by the
 * top-level `conjunction` (И/ИЛИ), where each group combines its own
 * CONDITIONS by the group's `conjunction`. This is enough to express
 * `(A И B) ИЛИ (C И D)` (arbitrary nesting is out of scope).
 *
 * Each condition targets ANY field — entity field OR page-local field (via a
 * pageId, exactly like automations) — of ANY type INCLUDING formula fields
 * (the condition compares the COMPUTED result), regardless of the field's
 * `isFilterable` opt-in. The predicate is ADMIN-AUTHORITATIVE (it may reference
 * fields hidden for some viewers); the returned rows still obey the viewer's
 * row/field permissions, exactly like a saved view's base filters.
 *
 * A condition's comparison value is either FIXED (`value`, set by the admin) or
 * USER-SUPPLIED at apply time (`valueSource: "input"` + `inputId`). A filter
 * declares its inputs in `inputsJson`; several conditions may reference the same
 * input, so one picked period feeds two date fields (the flagship
 * «Работы за период»: `Дата начала` в :период ИЛИ `Дата окончания` в :период).
 *
 * Managed under the `customFilters` RBAC capability (superAdmin bypasses).
 */

/** Comparison operators (type-aware in the editor). */
export const customFilterOperatorSchema = z.enum([
  "eq",
  "neq",
  "contains",
  "notContains",
  "gt",
  "lt",
  "gte",
  "lte",
  "between",
  "empty",
  "notEmpty",
]);
export type CustomFilterOperator = z.infer<typeof customFilterOperatorSchema>;

/** Runtime user-input types a filter can declare. */
export const customFilterInputTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "datetime",
  "dateRange",
  "numberRange",
  "select",
  "boolean",
]);
export type CustomFilterInputType = z.infer<typeof customFilterInputTypeSchema>;

/** A declared user-supplied input, referenced by conditions via its `id`. */
export const customFilterInputSchema = z.object({
  /** Stable id, referenced by a condition's `inputId`. */
  id: z.string().min(1),
  type: customFilterInputTypeSchema,
  /** Multilingual prompt label shown when the chip asks for the value. */
  labelJson: z
    .object({ ru: z.string().optional(), en: z.string().optional(), he: z.string().optional() })
    .default({}),
});
export type CustomFilterInput = z.infer<typeof customFilterInputSchema>;

/** A single condition: field + operator + value (fixed or user-supplied). */
export const customFilterConditionSchema = z.object({
  /**
   * Where the field lives.
   * - "entity" (default): a field of this entity.
   * - "page": a page-local field of a MIRROR page (`pageId`) of this entity.
   */
  fieldSource: z.enum(["entity", "page"]).optional(),
  /** The mirror page whose page-field to read (required when `fieldSource` is "page"). */
  pageId: z.number().int().optional(),
  fieldKey: z.string().min(1),
  operator: customFilterOperatorSchema,
  /**
   * How the comparison value is sourced.
   * - "static" (default): compare against the fixed `value`.
   * - "input": compare against a user-supplied value keyed by `inputId`.
   * Ignored for `empty`/`notEmpty` (which need no value).
   */
  valueSource: z.enum(["static", "input"]).optional(),
  /** A fixed value (used when `valueSource` is "static"/absent). For `between` a [from,to] pair. */
  value: z.unknown().optional(),
  /** The declared input to read (required when `valueSource` is "input"). */
  inputId: z.string().optional(),
});
export type CustomFilterCondition = z.infer<typeof customFilterConditionSchema>;

/** How multiple conditions/groups combine: all (AND) or any (OR). */
export const customFilterConjunctionSchema = z.enum(["and", "or"]);
export type CustomFilterConjunction = z.infer<typeof customFilterConjunctionSchema>;

/** A group of conditions combined by one conjunction. */
export const customFilterGroupSchema = z.object({
  conjunction: customFilterConjunctionSchema.default("and"),
  conditions: z.array(customFilterConditionSchema).default([]),
});
export type CustomFilterGroup = z.infer<typeof customFilterGroupSchema>;

export const customFiltersTable = pgTable(
  "custom_filters",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    nameJson: jsonb("name_json").notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    /** How the groups combine at the top level: "and" (all) or "or" (any). */
    conjunction: text("conjunction").notNull().default("and"),
    /** The two-level condition tree: an array of {conjunction, conditions}. */
    groupsJson: jsonb("groups_json").notNull().default([]),
    /** Declared user-supplied inputs referenced by conditions. */
    inputsJson: jsonb("inputs_json").notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("custom_filter_entity_idx").on(t.entityId)],
);

export const insertCustomFilterSchema = createInsertSchema(customFiltersTable, {
  groupsJson: z.array(customFilterGroupSchema),
  inputsJson: z.array(customFilterInputSchema),
  conjunction: customFilterConjunctionSchema,
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomFilter = z.infer<typeof insertCustomFilterSchema>;
export type CustomFilter = typeof customFiltersTable.$inferSelect;
