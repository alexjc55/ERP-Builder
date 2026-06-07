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
- Widget create requires the target page to actually be a dashboard (`isDashboardPage`).

## RBAC
- Widget CRUD/reorder is gated by the existing **`pages`** admin cap — managing dashboards == managing pages. No new RBAC cap was added.

## Chart widgets
- A widget is either `widgetType: "metric"` (number cards, the default/legacy shape) or `widgetType: "chart"`. `config.metrics` may be absent for charts — any edit-mode UI reading `config.metrics.length` MUST guard (`config.metrics?.length ?? 0`) or it crashes on chart widgets.
- Chart config = `{type: bar|line|area|pie|donut, entityId, groupBy:{kind: status|field, fieldKey?}, aggregation: count|sum, fieldKey?, statusIds?}`. Server computes a `series` of `{label, value, color?}` buckets, **admin-authoritative** exactly like metric values (same two auth gates before compute; same regex-guarded numeric cast for sum).
- Group-by status uses a LEFT JOIN to `entity_statuses` ordered by status `sortOrder`, with an explicit fallback label for null/dangling status. Group-by field buckets null/empty as "—", orders by aggregated value (`ORDER BY 2 DESC`), and caps at 50 buckets. Status `color` flows into series points so the client colors pie/bar cells.
- Frontend renders with **recharts**; widget `color` is a tailwind bg class, so charts map it to hex via a `TAILWIND_HEX` table (recharts needs real color values, not class names).

## Grid layout
- Widgets carry `gridW`/`gridH` (cell spans, default 1×1) persisted in CRUD. The viewer grid is a fixed-column CSS grid; each widget wrapper sets inline `gridColumn: span W` / `gridRow: span H`. Use inline styles, NOT dynamic tailwind `col-span-N` classes (they'd be purged). Clamp W to the column count and H to a sane max.

## Records column totals (related, not dashboard-specific)
- `records/query` returns `numericTotals` ({fieldKey → sum}) computed over the **full filtered set** (records are paginated, so totals must be server-side, never summed client-side from one page).
- Only numeric fields flagged `showColumnTotal` AND present in the request's `visibleFields` are summed — this preserves the hidden-field boundary (a hidden numeric field must never leak via its total). Same regex-guarded `::numeric` cast as dashboard sums.

## How to apply
- Adding a new metric aggregation type: extend the server aggregation helper AND `validateConfig`, and keep the regex-guarded cast for any numeric coercion.
- Any new endpoint returning widget data must re-apply both authorization gates before computing values.
