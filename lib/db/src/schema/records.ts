import { pgTable, serial, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { entityStatusesTable } from "./statuses";

export const entityRecordsTable = pgTable("entity_records", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id")
    .notNull()
    .references(() => entitiesTable.id, { onDelete: "cascade" }),
  valuesJson: jsonb("values_json").notNull().default({}),
  statusId: integer("status_id").references(() => entityStatusesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEntityRecordSchema = createInsertSchema(entityRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntityRecord = z.infer<typeof insertEntityRecordSchema>;
export type EntityRecord = typeof entityRecordsTable.$inferSelect;
