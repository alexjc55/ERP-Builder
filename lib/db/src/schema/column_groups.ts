import { pgTable, serial, jsonb, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** How a column group is rendered on the records-table header. */
export type ColumnGroupDisplayMode = "bar" | "fill";

/**
 * A global, page-independent column group. Columns (entity or page-local) point
 * at a group by id (the field's `columnGroupId` base, optionally overridden per
 * mirror page). The group carries a multilingual name and how it renders on the
 * table header:
 *  - "bar"  paints a thin colored top-border above the header cell (with a hover
 *           tooltip naming the group);
 *  - "fill" paints the whole header cell with `color` and the header text with
 *           `textColor` (falls back to white when unset).
 *
 * Deleting a group is "soft" from the columns' perspective: pointers to a removed
 * group simply stop rendering (no cascade onto fields/pages).
 */
export const columnGroupsTable = pgTable("column_groups", {
  id: serial("id").primaryKey(),
  nameJson: jsonb("name_json").notNull().default({}),
  color: text("color").notNull().default("#6366f1"),
  displayMode: text("display_mode").$type<ColumnGroupDisplayMode>().notNull().default("bar"),
  // Header text color when displayMode = "fill"; null/unset falls back to white.
  textColor: text("text_color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertColumnGroupSchema = createInsertSchema(columnGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertColumnGroup = z.infer<typeof insertColumnGroupSchema>;
export type ColumnGroup = typeof columnGroupsTable.$inferSelect;
