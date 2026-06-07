import { pgTable, serial, jsonb, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";

/**
 * A widget shown on a dashboard page. Belongs to a single dashboard page.
 *
 * configJson holds the aggregation spec (validated at the API boundary):
 *   {
 *     metrics: [{ key, entityId, aggregation: "count" | "sum", fieldKey?, statusIds?: number[] }],
 *     formula?: string,                       // references metric keys as {key}
 *     format?: "number" | "currency" | "percent",
 *   }
 *
 * visibleRoleIdsJson: null/empty = visible to every role that can see the page;
 * otherwise the explicit set of role ids that may see this widget. Real totals are
 * admin-authoritative — the metric values are computed bypassing the viewing role's
 * data permissions, so visibility here is the only access control on a widget.
 */
export const dashboardWidgetsTable = pgTable("dashboard_widgets", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id")
    .notNull()
    .references(() => pagesTable.id, { onDelete: "cascade" }),
  titleJson: jsonb("title_json").notNull().default({}),
  configJson: jsonb("config_json").notNull().default({}),
  visibleRoleIdsJson: jsonb("visible_role_ids_json").$type<number[]>(),
  icon: text("icon").notNull().default("bar-chart-3"),
  color: text("color").notNull().default("blue"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDashboardWidgetSchema = createInsertSchema(dashboardWidgetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDashboardWidget = z.infer<typeof insertDashboardWidgetSchema>;
export type DashboardWidget = typeof dashboardWidgetsTable.$inferSelect;
