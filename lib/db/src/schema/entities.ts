import { pgTable, serial, jsonb, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

export const entitiesTable = pgTable("entities", {
  id: serial("id").primaryKey(),
  entityKey: text("entity_key").notNull().unique(),
  nameJson: jsonb("name_json").notNull().default({}),
  descriptionJson: jsonb("description_json").default({}),
  icon: text("icon").notNull().default("table"),
  pageId: integer("page_id").references(() => pagesTable.id, { onDelete: "set null" }),
  defaultSortJson: jsonb("default_sort_json").notNull().default([]),
  // Filters applied to the records page when NO view is selected (the "main"
  // view). Same shape as a view's configJson.filters (FilterCondition[]).
  defaultFilterJson: jsonb("default_filter_json").notNull().default([]),
  // Enables the per-entity "Сводная таблица" (pivot) report mode on the records
  // page. Off by default; admins opt in per entity.
  pivotEnabled: boolean("pivot_enabled").notNull().default(false),
  // Default pivot (Сводная таблица) config for the records page when no view is
  // selected. Same shape as a view's configJson.pivot (PivotConfig). Null = the
  // default view offers no pivot.
  defaultPivotJson: jsonb("default_pivot_json"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEntitySchema = createInsertSchema(entitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEntity = z.infer<typeof insertEntitySchema>;
export type Entity = typeof entitiesTable.$inferSelect;
