import { pgTable, serial, jsonb, text, integer, boolean, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { pagesTable } from "./pages";

export const viewsTable = pgTable(
  "views",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    // Null = the entity's main records page. A concrete id scopes the view to
    // exactly one mirror page, which also makes that page's local fields
    // available to the view's authoritative hard filters.
    targetPageId: integer("target_page_id").references(() => pagesTable.id, { onDelete: "cascade" }),
    viewKey: text("view_key").notNull(),
    nameJson: jsonb("name_json").notNull().default({}),
    configJson: jsonb("config_json").notNull().default({}),
    // Role-based visibility for the view itself: null/empty = visible to every role
    // that can access the entity's records; otherwise the explicit set of role ids
    // that may select this view. Lets one page serve different roles different views
    // instead of cloning pages per role. NOT a data boundary — record/field/row
    // permissions still apply on top.
    visibleRoleIdsJson: jsonb("visible_role_ids_json").$type<number[]>(),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("view_entity_key_unique").on(t.entityId, t.viewKey),
    uniqueIndex("view_one_default_entity")
      .on(t.entityId)
      .where(sql`${t.isDefault} = true AND ${t.targetPageId} IS NULL`),
    uniqueIndex("view_one_default_page")
      .on(t.entityId, t.targetPageId)
      .where(sql`${t.isDefault} = true AND ${t.targetPageId} IS NOT NULL`),
  ],
);

export const insertViewSchema = createInsertSchema(viewsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertView = z.infer<typeof insertViewSchema>;
export type View = typeof viewsTable.$inferSelect;
