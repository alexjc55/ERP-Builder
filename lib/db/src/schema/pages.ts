import { pgTable, serial, jsonb, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pagesTable = pgTable("pages", {
  id: serial("id").primaryKey(),
  nameJson: jsonb("name_json").notNull().default({}),
  descriptionJson: jsonb("description_json").default({}),
  icon: text("icon").notNull().default("file"),
  path: text("path"),
  parentPageId: integer("parent_page_id"),
  // Mirror page: when set, this page displays the live records of an existing
  // entity (a second, read-through window onto another entity's data). Stored as
  // a plain integer (not a hard FK) to avoid a circular pages<->entities import;
  // existence is validated in the API and the renderer tolerates a dangling id.
  mirrorEntityId: integer("mirror_entity_id"),
  // Optional display projection: the subset of the mirrored entity's field keys
  // to show. Null/empty means "all visible fields". This is a display-level
  // projection only — real security (row scope, field hiding) is enforced by RBAC
  // on the mirrored entity.
  mirrorFieldKeysJson: jsonb("mirror_field_keys_json").$type<string[]>(),
  // Dashboard page: when true, this page renders admin-defined dashboard widgets
  // instead of entity records. Mutually exclusive with a bound entity and with
  // mirrorEntityId (enforced in the API and the pages editor). The renderer reads
  // this flag to pick the dashboard view over the records view.
  isDashboard: boolean("is_dashboard").notNull().default(false),
  // Default collapsed state of the analytics widgets block shown above a page's
  // records table. Admin-configurable; each viewer's own toggle is remembered
  // client-side (localStorage) and falls back to this default.
  widgetsCollapsedDefault: boolean("widgets_collapsed_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPageSchema = createInsertSchema(pagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPage = z.infer<typeof insertPageSchema>;
export type Page = typeof pagesTable.$inferSelect;
