import { pgTable, serial, jsonb, integer, boolean, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

/**
 * Stage 16 — Automations Engine.
 *
 * A per-entity automation is a rule: a single TRIGGER, optional type-aware
 * CONDITIONS (all must hold), and an ordered list of ACTIONS executed AS THE
 * SYSTEM (admin-authoritative — like workflow `set_field` and dashboard
 * widgets: it ignores the initiating user's RBAC and may move a record into any
 * status, overriding the «Процессы» transition graph). Automations are managed
 * under the `automations` RBAC capability (superAdmin bypasses).
 *
 * Event-based triggers (record.created / record.updated / field.changed /
 * status.changed) hook the existing in-process event bus. Date-based triggers
 * (date.reached) are evaluated by a periodic scheduler sweep; idempotency is
 * guaranteed by the partial-unique `dedupeKey` on the run log (one run per
 * record per due-instant).
 */

/** A condition's special "field" keys, alongside real entity field keys. */
export const CONDITION_STATUS_KEY = "__status__";

/** Comparison operators for conditions (type-aware on the client). */
export const automationConditionSchema = z.object({
  /** A real field key, or `__status__` to compare the record's statusId. */
  fieldKey: z.string().min(1),
  operator: z.enum(["eq", "neq", "contains", "gt", "lt", "gte", "lte", "empty", "notEmpty"]),
  /**
   * Where the LEFT operand (`fieldKey`) is read from.
   * - "entity" (default when absent): a field of the triggering entity record
   *   (or `__status__` for its status).
   * - "page": a page-local field of a MIRROR page of this entity, read from
   *   `(pageId, triggeringRecordId)`. Only supported for TOP-LEVEL automation
   *   conditions — never in an `update_records_where` match (those test other
   *   rows), where a page operand fails closed (reads empty).
   */
  fieldSource: z.enum(["entity", "page"]).optional(),
  /** The mirror page whose page-field to read (required when `fieldSource` is "page"). */
  pageId: z.number().int().optional(),
  /**
   * How the comparison value is sourced.
   * - "literal" (default when absent): compare against the fixed `value`.
   * - "field": compare against the TRIGGERING record's `valueFieldKey` value,
   *   resolved at run time. Lets one rule scope to the record that fired it
   *   (e.g. `update_records_where` match "order_number == trigger.order_number")
   *   instead of needing a separate automation per literal value.
   */
  valueSource: z.enum(["literal", "field"]).optional(),
  /** A fixed comparison value (used when `valueSource` is "literal"/absent). */
  value: z.unknown().optional(),
  /** The triggering record's field key to read (used when `valueSource` is "field"). */
  valueFieldKey: z.string().optional(),
});
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

/** How multiple conditions combine: all (AND) or any (OR). */
export const conditionConjunctionSchema = z.enum(["and", "or"]);
export type ConditionConjunction = z.infer<typeof conditionConjunctionSchema>;

/** Trigger: exactly one per automation. */
export const automationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record_created") }),
  z.object({ type: z.literal("record_updated") }),
  /** Fires only when the named field's value changes. */
  z.object({ type: z.literal("field_changed"), fieldKey: z.string().min(1) }),
  /** Fires on a status change; optionally constrained to a specific from/to. */
  z.object({
    type: z.literal("status_changed"),
    fromStatusId: z.number().int().nullable().optional(),
    toStatusId: z.number().int().nullable().optional(),
  }),
  /**
   * Fires when the date in `fieldKey` is reached (optionally +/- `offsetDays`).
   * Evaluated by the scheduler sweep, not the event bus.
   */
  z.object({
    type: z.literal("date_reached"),
    fieldKey: z.string().min(1),
    offsetDays: z.number().int().optional(),
  }),
  /**
   * Fires when a page-local field (`fieldKey`) on a MIRROR page (`pageId`) of
   * this entity is saved with a changed value. The triggering record is the
   * entity record whose page value changed.
   */
  z.object({
    type: z.literal("page_field_changed"),
    pageId: z.number().int(),
    fieldKey: z.string().min(1),
  }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

/** How a target field's value is sourced when creating/updating records. */
export const automationMappingSchema = z.object({
  targetFieldKey: z.string().min(1),
  /**
   * "literal": use `value` as-is; "field": copy from the triggering record's
   * `sourceFieldKey`; "combined": `value` is a text template with `{fieldKey}`
   * (and `{__status__}`) placeholders interpolated against the triggering
   * record's display values.
   */
  sourceType: z.enum(["literal", "field", "combined"]),
  value: z.unknown().optional(),
  sourceFieldKey: z.string().optional(),
  /**
   * When `sourceType` is "field", where `sourceFieldKey` is read from.
   * - "entity" (default when absent): the triggering entity record's field.
   * - "page": a page-local field of a MIRROR page (`sourcePageId`) of this
   *   entity, read from `(sourcePageId, triggeringRecordId)`.
   */
  sourceFieldSource: z.enum(["entity", "page"]).optional(),
  /** The mirror page to read from (required when `sourceFieldSource` is "page"). */
  sourcePageId: z.number().int().optional(),
  /**
   * Where the value is WRITTEN. Only honored by `update_records_where`.
   * - "entity" (default when absent): a field of each matched target record.
   * - "page": a page-local field on a MIRROR page (`targetPageId`) of the
   *   action's `targetEntityId`, written AS SYSTEM at `(targetPageId, matchedRecordId)`.
   */
  targetFieldSource: z.enum(["entity", "page"]).optional(),
  /** The mirror page to write to (required when `targetFieldSource` is "page"). */
  targetPageId: z.number().int().optional(),
});
export type AutomationMapping = z.infer<typeof automationMappingSchema>;

/** Actions: executed in order, as the system. */
export const automationActionSchema = z.discriminatedUnion("type", [
  /**
   * Set a field on the triggering record. When `targetFieldSource` is "page",
   * writes a page-local field on a MIRROR page (`targetPageId`) of this entity
   * at `(targetPageId, triggeringRecordId)` instead of the entity record.
   */
  z.object({
    type: z.literal("set_field"),
    fieldKey: z.string().min(1),
    value: z.unknown(),
    targetFieldSource: z.enum(["entity", "page"]).optional(),
    targetPageId: z.number().int().optional(),
  }),
  /** Move the triggering record to a status directly (overrides «Процессы»). */
  z.object({ type: z.literal("change_status"), statusId: z.number().int() }),
  /** Create a new record on `targetEntityId` (this or another entity). */
  z.object({
    type: z.literal("create_record"),
    targetEntityId: z.number().int(),
    mapping: z.array(automationMappingSchema).default([]),
    statusId: z.number().int().nullable().optional(),
  }),
  /** Update every record of `targetEntityId` matching `match` (all conditions). */
  z.object({
    type: z.literal("update_records_where"),
    targetEntityId: z.number().int(),
    match: z.array(automationConditionSchema).default([]),
    mapping: z.array(automationMappingSchema).default([]),
  }),
  /** POST the (optional) record payload to an external URL (SSRF-guarded). */
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    includeRecord: z.boolean().optional(),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const entityAutomationsTable = pgTable(
  "entity_automations",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    nameJson: jsonb("name_json").notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    triggerJson: jsonb("trigger_json").notNull(),
    conditionsJson: jsonb("conditions_json").notNull().default([]),
    /** How conditionsJson combine: "and" (all) or "or" (any). */
    conditionConjunction: text("condition_conjunction").notNull().default("and"),
    actionsJson: jsonb("actions_json").notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("entity_automation_entity_idx").on(t.entityId)],
);

export const entityAutomationRunsTable = pgTable(
  "entity_automation_runs",
  {
    id: serial("id").primaryKey(),
    automationId: integer("automation_id")
      .notNull()
      .references(() => entityAutomationsTable.id, { onDelete: "cascade" }),
    entityId: integer("entity_id").notNull(),
    recordId: integer("record_id"),
    /** "success" | "error" | "skipped". */
    status: text("status").notNull(),
    /** Human-readable trigger label captured at run time. */
    triggerName: text("trigger_name"),
    /** { actionsRun, error?, ... } — best-effort diagnostics. */
    detailJson: jsonb("detail_json").notNull().default({}),
    /**
     * Idempotency marker for date-based triggers: the partial-unique index makes
     * a (automation, record, due-instant) run exactly once. Null for event runs.
     */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entity_automation_run_automation_idx").on(t.automationId),
    index("entity_automation_run_entity_idx").on(t.entityId),
    uniqueIndex("entity_automation_run_dedupe_unique")
      .on(t.automationId, t.recordId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

export const insertEntityAutomationSchema = createInsertSchema(entityAutomationsTable, {
  triggerJson: automationTriggerSchema,
  conditionsJson: z.array(automationConditionSchema),
  conditionConjunction: conditionConjunctionSchema,
  actionsJson: z.array(automationActionSchema),
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntityAutomation = z.infer<typeof insertEntityAutomationSchema>;
export type EntityAutomation = typeof entityAutomationsTable.$inferSelect;
export type EntityAutomationRun = typeof entityAutomationRunsTable.$inferSelect;
