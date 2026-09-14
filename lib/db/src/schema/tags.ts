import { pgTable, serial, jsonb, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entityStatusesTable } from "./statuses";

/**
 * Global reusable labels. `applicableTo` is deliberately an array so additional
 * tag targets can be introduced without changing the stable tag id contract.
 */
export const tagsTable = pgTable("tags", {
  id: serial("id").primaryKey(),
  nameJson: jsonb("name_json").notNull().default({}),
  color: text("color").notNull().default("#6b7280"),
  sortOrder: integer("sort_order").notNull().default(0),
  applicableTo: text("applicable_to").array().notNull().default(["statuses"]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Status-to-tag assignment. A status can carry any number of global tags. */
export const statusTagsTable = pgTable(
  "status_tags",
  {
    statusId: integer("status_id")
      .notNull()
      .references(() => entityStatusesTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.statusId, t.tagId] })],
);

export const insertTagSchema = createInsertSchema(tagsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTag = z.infer<typeof insertTagSchema>;
export type Tag = typeof tagsTable.$inferSelect;
export type StatusTag = typeof statusTagsTable.$inferSelect;