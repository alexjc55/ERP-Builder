import { pgTable, serial, jsonb, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { entityStatusesTable } from "./statuses";

/**
 * A workflow transition: an allowed move from one status to another for an
 * entity. A "workflow" for an entity is simply the set of its statuses plus
 * these transitions — there is no separate workflow table. When an entity has
 * at least one transition defined, status changes on its records are restricted
 * to the defined transitions (enforced server-side); entities with no
 * transitions keep free status changes (backward compatible).
 */
export const entityTransitionsTable = pgTable(
  "entity_transitions",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    fromStatusId: integer("from_status_id")
      .notNull()
      .references(() => entityStatusesTable.id, { onDelete: "cascade" }),
    toStatusId: integer("to_status_id")
      .notNull()
      .references(() => entityStatusesTable.id, { onDelete: "cascade" }),
    nameJson: jsonb("name_json").notNull().default({}),
    /** Role ids allowed to perform the transition. Empty = any role. */
    allowedRoleIds: jsonb("allowed_role_ids").notNull().default([]),
    /** Field keys that must be non-empty for the transition to succeed. */
    requiredFieldKeys: jsonb("required_field_keys").notNull().default([]),
    /** Actions applied on transition, e.g. [{type:"set_field",fieldKey,value}]. */
    actionsJson: jsonb("actions_json").notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("entity_transition_pair_unique").on(t.entityId, t.fromStatusId, t.toStatusId),
    index("entity_transition_entity_idx").on(t.entityId),
    index("entity_transition_from_idx").on(t.fromStatusId),
  ],
);

export const transitionActionSchema = z.object({
  type: z.literal("set_field"),
  fieldKey: z.string().min(1),
  value: z.unknown(),
});
export type TransitionAction = z.infer<typeof transitionActionSchema>;

export const insertEntityTransitionSchema = createInsertSchema(entityTransitionsTable, {
  allowedRoleIds: z.array(z.number().int()),
  requiredFieldKeys: z.array(z.string()),
  actionsJson: z.array(transitionActionSchema),
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntityTransition = z.infer<typeof insertEntityTransitionSchema>;
export type EntityTransition = typeof entityTransitionsTable.$inferSelect;
