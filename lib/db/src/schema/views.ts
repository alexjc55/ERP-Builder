import { pgTable, serial, jsonb, text, integer, boolean, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const viewsTable = pgTable(
  "views",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    viewKey: text("view_key").notNull(),
    nameJson: jsonb("name_json").notNull().default({}),
    configJson: jsonb("config_json").notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("view_entity_key_unique").on(t.entityId, t.viewKey),
    uniqueIndex("view_one_default").on(t.entityId).where(sql`${t.isDefault} = true`),
  ],
);

export const insertViewSchema = createInsertSchema(viewsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertView = z.infer<typeof insertViewSchema>;
export type View = typeof viewsTable.$inferSelect;
