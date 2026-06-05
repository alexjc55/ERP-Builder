import { pgTable, serial, jsonb, text, integer, boolean, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const entityStatusesTable = pgTable(
  "entity_statuses",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    statusKey: text("status_key").notNull(),
    nameJson: jsonb("name_json").notNull().default({}),
    color: text("color").notNull().default("#6b7280"),
    isDefault: boolean("is_default").notNull().default(false),
    isFinal: boolean("is_final").notNull().default(false),
    isArchiveTrigger: boolean("is_archive_trigger").notNull().default(false),
    archiveAfterDays: integer("archive_after_days").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("entity_status_key_unique").on(t.entityId, t.statusKey),
    uniqueIndex("entity_status_one_default").on(t.entityId).where(sql`${t.isDefault} = true`),
  ],
);

export const insertEntityStatusSchema = createInsertSchema(entityStatusesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntityStatus = z.infer<typeof insertEntityStatusSchema>;
export type EntityStatus = typeof entityStatusesTable.$inferSelect;
