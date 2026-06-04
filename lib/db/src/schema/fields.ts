import { pgTable, serial, jsonb, text, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

/** Per-field access level for a role. Unset role inherits the role's record perms. */
export type FieldAccess = "hidden" | "view" | "edit";

/** Field-level permission map: stringified roleId -> access level. */
export type FieldPermissions = Record<string, FieldAccess>;

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
