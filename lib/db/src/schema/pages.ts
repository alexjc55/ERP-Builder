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
  // Optional per-mirror-page DISPLAY label override for mirrored source-entity
  // fields, keyed by fieldKey → multilingual {ru,en,he}. Lets a mirror page show
  // a different column/field label (e.g. "Цена для производителя" → "Цена")
  // WITHOUT touching the source field. Display-only — never a security boundary;
  // field identity and hiding stay keyed off fieldKey + RBAC on the source entity.
  mirrorFieldLabelsJson: jsonb("mirror_field_labels_json").$type<Record<string, { ru?: string; en?: string; he?: string }>>(),
  // Optional per-mirror-page UNIFIED COLUMN ORDER across both the mirrored
  // entity's columns and the page's own page-local columns. Stored as an ordered
  // array of tokens: "e:<fieldKey>" for a source-entity field, "p:<fieldKey>" for
  // a page-local field. Lets a mirror page interleave page-local columns between
  // entity columns and keep an order independent of the source entity's field
  // sortOrder. Null/empty means "default order" (entity columns by sortOrder,
  // then page columns). Display-only — never a security boundary. Columns not
  // listed fall back to the default order, appended after the listed ones.
  mirrorColumnOrderJson: jsonb("mirror_column_order_json").$type<string[]>(),
  // Per-page column-group OVERRIDE map for entity (source) columns, keyed by the
  // unified token "e:<fieldKey>" → column_groups.id. Only meaningful on a mirror
  // page: it lets the mirror assign a DIFFERENT group than the source field's
  // base `columnGroupId` (inheritance). A key present overrides; value 0 means
  // "force no group"; absent means "inherit the field's base group". Page-local
  // columns are never stored here (their base on page_fields is authoritative).
  columnGroupsJson: jsonb("column_groups_json").$type<Record<string, number>>(),
  // Dashboard page: when true, this page renders admin-defined dashboard widgets
  // instead of entity records. Mutually exclusive with a bound entity and with
  // mirrorEntityId (enforced in the API and the pages editor). The renderer reads
  // this flag to pick the dashboard view over the records view.
  isDashboard: boolean("is_dashboard").notNull().default(false),
  // Pivot page: when true, this page renders a single full-page pivot
  // (Сводная таблица) cross-tab instead of records/widgets. Mutually exclusive
  // with a bound entity, mirrorEntityId and isDashboard (enforced in the API and
  // the pages editor). Totals are ADMIN-AUTHORITATIVE (real aggregates over all
  // records, identical for everyone with page access), so role gating is the
  // existing per-role page access — no per-page role list here.
  isPivot: boolean("is_pivot").notNull().default(false),
  // The entity this pivot page reports on. A plain integer (not a hard FK) to
  // avoid a circular pages<->entities import; existence validated in the API and
  // the renderer/compute tolerates a dangling id (degrades to empty).
  pivotEntityId: integer("pivot_entity_id"),
  // Pivot page configuration. `source` selects where the PivotConfig comes from:
  //  - "entity": use the entity's defaultPivotJson at compute time,
  //  - "view":   use the referenced pivot view's configJson.pivot (viewId),
  //  - "custom": use the inline `pivot` PivotConfig stored here.
  // `filters`/`filterConjunction`/`statusIds`/`search` pre-filter which records
  // feed the aggregation (applied admin-authoritatively over all active fields).
  pivotConfigJson: jsonb("pivot_config_json").$type<{
    source: "entity" | "view" | "custom";
    viewId?: number | null;
    pivot?: unknown;
    filters?: unknown[];
    filterConjunction?: "and" | "or";
    statusIds?: number[];
    search?: string | null;
  }>(),
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
