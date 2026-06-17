---
name: Dashboard page type
description: How the configurable role-aware dashboard page type works and the invariants that must stay consistent across server + client.
---

# Dashboard page type

A page can be one of three mutually exclusive types: **normal (optionally entity-bound)**, **mirror**, or **dashboard** (`pages.isDashboard`). A dashboard page renders admin-defined widgets instead of records.

## Widgets & metrics
- A widget = one or more **metrics** plus an optional **formula** combining them. Metric = `count` or `sum` over an entity, optionally restricted to `statusIds`, with `sum` requiring a numeric `fieldKey`.
- Formula evaluation is **client-side** (`erp-platform/src/lib/formula.ts` `evaluateFormula(expr, valuesMap)` with `{metricKey}` refs). The server returns **raw metric values only**; it never evaluates formulas. `resolveValue` uses the formula if set, else the first metric.
- API body uses `config` / `visibleRoleIds`; DB columns are `configJson` / `visibleRoleIdsJson`.

## Admin-authoritative totals (the key design decision)
- Metric counts/sums are computed **bypassing the viewing role's row/field RBAC** — they are *real* totals. **Why:** a dashboard is meant to show true aggregate numbers, not numbers filtered to what the viewer could see row-by-row.
- This is safe because values are only ever computed/shipped for widgets the viewer is authorized to see. Authorization happens *before* computation via two gates:
  1. Page access: `superAdmin || perms.pageIds.includes(pageId)`.
  2. Per-widget role visibility: `visibleRoleIds` null/empty = all roles; otherwise must include the viewer's roleId; superAdmin sees all.

## Sum cast safety
- Sum casts JSONB text → numeric. Guard the cast with a numeric regex (`NUMERIC_RE`) in a CASE so non-numeric stored values become 0 instead of erroring. `fieldKey` is validated by `validateConfig` to be a real numeric field of the target entity AND is always a bound param (never string-interpolated).

## Mutual-exclusivity invariant (dashboard ⊥ mirror ⊥ bound-entity)
Must be enforced on **every** path that can change page type, against the **effective final state** (current DB row merged with the patch), not just the fields present in a request:
- `PUT /pages/:id`: load current `{mirrorEntityId, isDashboard}`, compute effective values, reject conflicts. **Why:** flipping only `isDashboard` on a page that already mirrors, or setting `mirrorEntityId` while omitting `isDashboard`, would otherwise slip through.
- `routes/entities.ts validatePageBinding`: reject binding an entity to a page that is a dashboard (or mirror).
- Widget create only requires the target page to **exist** (`pageExists`), NOT to be a dashboard — see "Widgets are page-scoped, not dashboard-scoped" below. Attaching widgets does not change page type, so it never threatens this invariant.

## Widgets are page-scoped, not dashboard-scoped (analytics strip on records pages)
- `dashboard_widgets` may live on ANY page. A dashboard page renders them as its whole body; a **normal entity-bound or mirror page renders them as an analytics strip above the records table**. **Why:** the user wanted dashboard-style widgets above ordinary record tables, and any FUTURE widget variant must appear there automatically.
- Reuse is achieved by **embedding the same `DashboardView` component** (an optional `embedded` prop), NOT by duplicating widget rendering. So new widget variants added to the dashboard are automatically available on records pages — do not fork the widget UI.
- `embedded` mode: returns `null` for non-editor viewers with no widgets (no empty card / no skeleton flash on every records page); still shows the editor toggle (gated by `canAdmin("pages")`) so admins can add the first widget; section labeled `dash.analyticsSection` ("Аналитика").
- The embedded strip is rendered in `dynamic.tsx` as a **sibling ABOVE `EntityRecords`**, NOT inside it. **Why:** `EntityRecords` early-returns on `!canView` (no entity record:view) and on no-fields, both of which would hide the widgets. But widget role-visibility AND the `pages` admin cap (widget edit mode) are **independent** of entity `record:view`, so a page-admin or widget-authorized viewer who lacks record:view must still see/manage widgets. Keeping the strip outside `EntityRecords` bypasses that gating.
- Server data endpoint (`GET /pages/:id/dashboard/data`) was already page-type-agnostic (only `canAccessPage` + per-widget role visibility). The admin-authoritative totals are safe on records pages for the same reason as dashboards: values are computed only for widgets the viewer is authorized to see (the two gates), independent of the records table's own row/field RBAC.

## RBAC
- Widget CRUD/reorder is gated by the existing **`pages`** admin cap — managing dashboards == managing pages. No new RBAC cap was added.

## Formula widget (`widgetType: "formula"`)
- A `formula` widget shares the metric model entirely: same `config.metrics` (treated as formula "terms"), same `config.formula` + `config.format`, same server `computeMetric`. It exists only as a distinct widgetType so the client renders a formula-first editor (relabeled "Поля формулы"/"Вставить поле", formula non-optional in copy) and viewers see a single number card.
- **Why a new type rather than just using metric+formula:** the user wanted a dedicated card whose purpose is "combine fields across entities/pages into one number". The metric widget already supports per-term independent entity/page source + a formula, so the new type is a UX wrapper, not new compute.
- **Round-trip rule:** the metric serialize path sets `widgetType = widgetType === "formula" ? "formula" : "metric"`, and the data endpoint mirrors that on read — both must stay in lockstep or an edited formula widget silently reverts to metric. `validateConfig` deliberately falls through to the metric path (≥1 term required); do NOT add a separate formula branch unless the model diverges.
- The viewer needs NO formula branch: it falls through to the metric number-card render (`resolveValue`/`formatValue`). Any code reading `config.metrics.length` must still guard (`?? 0`) — same caveat as charts.

## Chart widgets
- A widget is either `widgetType: "metric"` (number cards, the default/legacy shape) or `widgetType: "chart"`. `config.metrics` may be absent for charts — any edit-mode UI reading `config.metrics.length` MUST guard (`config.metrics?.length ?? 0`) or it crashes on chart widgets.
- Chart config = `{type: bar|line|area|pie|donut, entityId, groupBy:{kind: status|field, fieldKey?}, aggregation: count|sum, fieldKey?, statusIds?}`. Server computes a `series` of `{label, value, color?}` buckets, **admin-authoritative** exactly like metric values (same two auth gates before compute; same regex-guarded numeric cast for sum).
- Group-by status uses a LEFT JOIN to `entity_statuses` ordered by status `sortOrder`, with an explicit fallback label for null/dangling status. Group-by field buckets null/empty as "—", orders by aggregated value (`ORDER BY 2 DESC`), and caps at 50 buckets. Status `color` flows into series points so the client colors pie/bar cells.
- Frontend renders with **recharts**; widget `color` is a tailwind bg class, so charts map it to hex via a `TAILWIND_HEX` table (recharts needs real color values, not class names).

## Grid layout
- Widgets carry `gridW`/`gridH` (cell spans, default 1×1) persisted in CRUD. The viewer grid is a fixed-column CSS grid; each widget wrapper sets inline `gridColumn: span W` / `gridRow: span H`. Use inline styles, NOT dynamic tailwind `col-span-N` classes (they'd be purged). Clamp W to the column count and H to a sane max **on both the viewer and edit-mode renders**.
- Size is **grid-controlled** in admin edit mode (inline +/- steppers persist via a silent full-`config` PUT — PUT requires the whole `DashboardWidgetInput`, so resize reconstructs the full input). **The widget editor dialog must NOT send `gridW`/`gridH` on edit** (omit them so the server preserves current size); only set defaults (1×1) on create. **Why:** the dialog captures size at open time, so if it sent size on save it could revert an in-flight inline resize (last-write-wins race).

## Records column totals (related, not dashboard-specific)
- `records/query` returns `numericTotals` ({fieldKey → sum}) computed over the **full filtered set** (records are paginated, so totals must be server-side, never summed client-side from one page).
- Only numeric fields flagged `showColumnTotal` AND present in the request's `visibleFields` are summed — this preserves the hidden-field boundary (a hidden numeric field must never leak via its total). Same regex-guarded `::numeric` cast as dashboard sums.
- A field opting into `showColumnTotal` may also set freeform hex `totalFillColor`/`totalTextColor` (nullable text cols on BOTH `fields` and `page_fields`); the totals cell applies them via inline `style`, falling back to the emerald tailwind classes when null. Hex → inline style, never tailwind classes (no purge concern). **Why:** the two dialogs (FieldConfigDialog / PageFieldConfigDialog) and two schemas must stay in lockstep, and PUT allowlists are easy to miss — `showColumnTotal` itself was silently absent from the page-fields update allowlist, so any new dependent setting must verify the toggle persists too.

## Widget icon is optional (empty = no icon)
- A widget's `icon` may be an empty string, meaning "render no icon" — it is NOT required (irrelevant for chart/table widgets, and some admins want a bare metric card). The IconPicker has a "Очистить" (clear) action that sets `icon=""`.
- **Display code must treat empty icon as "no icon", never fall back to a default.** Use `w.icon ? getIconComponent(w.icon) : null` and conditionally render the icon box. **Why:** the old `w.icon || DEFAULT_ICON` fallback (in card renders AND the editor `useState` init) coerced a cleared icon back to the default, so users couldn't actually save a widget without an icon — it always "reappeared".
- Editor init must distinguish create vs edit: new widget → `DEFAULT_ICON`; existing widget → `widget.icon ?? ""` (use `??`, not `||`, so a stored empty string is preserved). Server already persists `""` correctly (`body.icon != null` is true for empty string; column is notNull with a default only for omitted icons).

## Widget color style (icon / border / fill)
- A metric widget's `color` (a tailwind bg-* class) can be applied three ways via `config.colorStyle`: `icon` (default, tint icon box only), `border` (colored card border), `fill` (fill whole card + `config.textColor` light|dark for font color). Stored in the config JSONB — NOT new DB columns (no migration). Added to OpenAPI WidgetConfig + DashboardWidgetData; server threads them into the dashboard-data `base`, coercing to the enum on read (defends against direct-DB edits since the write path is Zod-validated).
- **Tailwind purge trap:** border mode needs a `border-*` class per preset — these are kept as a literal `COLOR_BORDER` map (bg-class → border-class), never derived by string-replacing `bg-`→`border-`, or Tailwind's content scanner purges them. **Why:** dynamically-built class names aren't seen by the scanner.
- colorStyle/textColor are metric-only in the UI (chart `color` means series color; fill would make a chart unreadable). textColor is a deliberate manual admin choice — do NOT auto-override it for contrast; the user asked to control font color themselves.

## Table widgets — status column, clickable rows, "Смотреть все"
- A table widget's `config.table.fieldKeys` may include the sentinel `"__status"` (const `STATUS_COLUMN_KEY`, declared independently in BOTH `dashboard.ts` server and `DashboardView.tsx` client — keep in lockstep). It is a synthetic column, not a stored field: `validateTableConfig` exempts it, and `computeTableData` resolves a `{name,color}` per row from `entity_statuses` (selected via `records.statusId`) and emits a column `{fieldKey:"__status", fieldType:"status"}`. Client renders it as a colored Badge.
- **The status column is admin-authoritative like all widget values** — it does NOT re-apply the entity's field-hidden boundary. Acceptable for the same reason as metric/chart values: data is only computed/shipped for widgets the viewer is authorized to see (page access + per-widget role visibility gates).
- The dashboard-data endpoint ships `tableEntityId` on table widgets so the client can map entity → its bound records page (`entities.pageId` → `pages.path`). Rows deep-link to `${path}?record=<id>`; a "Смотреть все" footer links to `${path}`. Both render **only when the entity has a bound page**.

## Deep-link to a record (`?record=<id>`)
- `EntityRecords` reads `?record=<id>` (wouter `useSearch`), fetches via `useGetRecord` (server-gated by the records read boundary — the deep-link inherits real RBAC, not a bypass), opens the edit dialog, then strips only the `record` param (preserving other query params) via `navigate(..., {replace:true})`.
- **Must wait for field metadata** (`!fieldsLoading && fields.length>0`) before opening — `openEdit` seeds the form from `fields`, so opening on a cold load yields an empty form. Guard with a `handledDeepLinkRef` so it fires once per id and never loops.

## Embedded widgets collapse/expand
- The embedded analytics strip has a per-viewer collapse toggle (chevron next to "Аналитика"), shown to ALL viewers (not just editors). State precedence: localStorage `erp.widgets.collapsed.<pageId>` ("1"/"0") overrides the admin default `pages.widgetsCollapsedDefault`.
- `collapsed` state is `boolean | null`; null = no stored override → an effect applies the page's admin default once `thisPage` loads. **Rehydrate on `pageId` change** (effect keyed on pageId re-reads localStorage) so collapse state never leaks across pages. Collapse is **embedded-only** (`isCollapsed = embedded && collapsed === true`); admin edit mode force-shows the body even when collapsed.
- Admins set the default via a "Свёрнуто по умолчанию" checkbox in edit mode → `PUT /pages/:id { widgetsCollapsedDefault }` (in the `pages` update allowlist; reuses the `pages` cap, no new cap).

## Notes widgets (rich-text + free-form live-value table)
- `widgetType: "notes"` is a fourth widget shape that, like every widget, lives on ANY page and rides the embedded `DashboardView` automatically. Two modes: rich-text HTML blob, or a free-form cell grid where each cell is static text OR a dynamic "live value".
- **Rich-text must be double-sanitized** — once server-side on every write (allowlist) AND again client-side before render. Never trust stored HTML on read; a direct-DB edit could inject. **Why:** stored HTML is attacker-reachable through the DB even though the write path sanitizes. Editor is Tiptap v3, whose StarterKit already bundles underline/link/lists — re-adding them throws a duplicate-extension error.
- **A dynamic cell's source is either a metric aggregate or a single record's field value, computed admin-authoritative** (bypasses the viewer's row/field RBAC — gated only by page-access + per-widget role visibility, same as all widget totals). This is intentional: a record-source can surface a field value the viewer normally can't see; the boundary is widget visibility, not field RBAC.
- **The notes table grid is bounded server-side** (max rows/cols/total cells in `validateNotesConfig`) so an admin can't submit a huge grid that drives heavy per-cell compute. **Why:** every dynamic cell triggers its own DB queries at view time. Any source restriction (e.g. `statusIds`) must be validated against the source entity, mirroring table-widget status validation — reusing `validateMetricLike` alone does NOT cover statusIds.

## Notes inline editing on the page (no widget edit mode)
- Notes widgets are editable in place by **non-admins too**, gated by a per-widget `notes.editableRoleIds` (mirrors `visibleRoleIds`). The write endpoint is `PUT /dashboard/widgets/:wid/notes-content` and uses `requireAuth` ONLY — NOT `requireAdmin` — so authorization is the `canEditNotesContent` helper, not a route guard. **Why:** the whole point is letting selected roles edit content without the `pages`/admin cap that the rest of the dashboard editor requires.
- `canEditNotesContent` is the hard boundary and is the SAME predicate used to compute the read-side `canEditNotes` flag shipped to the viewer: superAdmin || `admin.pages` always; else page-access AND widget-visible-to-role AND `roleId ∈ editableRoleIds`. The client flag is cosmetic only — the server re-checks on write.
- **The server is the source of truth for STRUCTURE.** A content edit can only change *values*, never shape: richtext → re-sanitize html; table → clone the stored grid and update `text` of addressed cells, rejecting any coordinate that doesn't exist or whose `kind !== "static"`. Dynamic/computed cells and the grid/sources are never mutated from the client payload. `kind` of the edit must match the widget's notes kind.
- **Known limitation: last-write-wins.** The handler does a read-modify-write of the whole `configJson` (`{...config, notes: nextNotes}`), so two concurrent editors (even on different cells) can clobber each other. Acceptable for this feature; if it ever matters, add an `updatedAt`/version precondition (compare-and-set) like the workflow engine does.
- Viewer UI (`EditableNotesContent`/`EditableNotesRichText`/`EditableNotesTable` in `DashboardView.tsx`): richtext = hover-pencil → inline `RichTextEditor` + Save/Cancel; table static cells = click → textarea → blur/Enter saves one-cell patch. Mutation `useUpdateNotesContent` + dashboard `invalidate()`. When `canEditNotes` is false it falls back to the plain read-only `NotesRichText`/`NotesTable`.

## Page-local field values as a widget value source (`source: "page"`)
- Metric and chart specs carry `source: "entity"|"page"` (default `entity`) + `pageId`. `source:"page"` aggregates a **page-local field** (`page_record_values.values_json ->> fieldKey`) instead of an entity field. **Why:** page-local fields (mirror-page / page-scoped values) live in `page_record_values`, not `entity_records.values_json`, so they were previously invisible to widgets.
- Server resolves the page's entity via `resolvePageEntityId(pageId)` = `entities.pageId` else `pages.mirrorEntityId`; `resolvePageLocalField(pageId, fieldKey)` returns `{fieldType}|null` (null if the page field is inactive/missing). Compute is `FROM entity_records er LEFT JOIN page_record_values prv ON prv.record_id = er.id AND prv.page_id = :pageId`, value = `prv.values_json ->> fieldKey`.
- **Page-source count = count of records whose page-local value is non-empty** (`COUNT(*) FILTER WHERE NULLIF(value,'') IS NOT NULL`), NOT total record count — a page metric AND a page chart ALWAYS need a `fieldKey`, even for `count` (unlike an entity count which needs none). **Why:** a page-source widget exists to aggregate a specific page-local field; a bare `count(*)` would ignore the page field entirely (degenerate). The chart value field is orthogonal to group-by (you can count non-empty of field A grouped by status or by field B). Sum reuses the same `NUMERIC_RE`-guarded cast. Group-by status still uses `er.status_id`; group-by field uses the page-local value.
- **Relations are entity-only** — a page-source metric forbids `relationId` (validated server-side). Status filtering UI is hidden for page source (server still tolerates `statusIds`); the client sends `statusIds:null`, `relationId:null` for page metrics.
- Admin-authoritative + the SAME two auth gates as every widget value (page access + per-widget role visibility before compute). No new RBAC.
- Client (`DashboardView` MetricEditor/ChartEditor): a "Источник данных" selector toggles entity vs page; page mode shows a page picker + page-field picker (count → any non-file/function field, sum/group → numeric only). `entityId` is sent as a `0` sentinel for page source (contract requires it but the server ignores it and resolves the page's entity). Page-field lists are fetched via `useListPageFields(pageId)` and normalized to `{key,label}` so the same picker renders for both sources.

## How to apply
- Adding a new metric aggregation type: extend the server aggregation helper AND `validateConfig`, and keep the regex-guarded cast for any numeric coercion.
- Any new endpoint returning widget data must re-apply both authorization gates before computing values.
- Any new widget type: add to OpenAPI `WidgetConfig`/`DashboardWidgetData` (+widgetType enum) → codegen → server validate+compute branches (gated) → `DashboardView` viewer branch + editor branch + buildData. It rides the embedded strip automatically; do not fork widget UI.

## Notes table column resize
- Notes-table columns are resizable by dragging a right-edge grip (double-click resets). Widths are **per-user/per-browser only** — stored in localStorage `erp:notescolwidths:${widgetId}`, keyed by **positional column index** (the notes table has no header keys), NOT server-persisted. **Why:** mirrors the records table (`EntityRecords`) convention; an admin therefore CANNOT push widths to all viewers — if shared widths are ever needed, add a `colWidths` array to `NotesConfig` (OpenAPI → codegen → server sanitize/validate). **How to apply:** the `useNotesColResize` hook + `notesColStyle` + `NotesResizeGrip` live in `DashboardView.tsx`; auto-layout tables need `width+minWidth+maxWidth` (all three) on cells to honour a forced width; the grip must `stopPropagation` so it doesn't trigger the cell's click-to-edit.
