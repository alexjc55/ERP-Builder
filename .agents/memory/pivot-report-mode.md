---
name: Pivot report mode (Сводная таблица)
description: Durable invariants for the entity-based interactive pivot view type — its opt-in gates, permission scoping, and the dim-type whitelist that must stay in sync.
---

# Pivot report mode — durable decisions

Pivot is a new **view type** (`viewType: "pivot"` in a saved View's `configJson`), not a separate
screen or page type. It reuses the Views engine + the live records filter bar. Records page shows a
Таблица⇄Сводная toggle, gated on the entity's `pivotEnabled` flag.

## Permission scoping — NOT admin-authoritative
Unlike dashboard widgets (which bypass viewer RBAC), pivot is **permission-scoped to the viewer**.
The pivot compute endpoint (`POST /entities/{id}/records/pivot`) MUST reuse the exact same
records/query read boundary:
- `buildRecordQuery(visibleFields, …)` so hidden fields are excluded *before* aggregation,
- `effectiveScopeFor` + `ownScopeWhere` for own-rows row scope,
- `hiddenRowStatusWhere` for role-hidden statuses,
- `archivedWhere`, `search`, `statusIds`, `pageLocalFilters` with the same validation.
**Why:** a pivot is just an aggregation over rows the viewer can already see; it must never become a
side channel that leaks counts/sums over hidden fields, restricted statuses, or other users' rows.

## Three independent opt-in gates, all enforced server-side
1. **Entity gate:** `entities.pivotEnabled` must be true or the endpoint 400s.
2. **Per-field gate:** a field is usable as a dim/measure only if it's visible to the viewer AND has
   its own `pivotEnabled` flag AND is an allowed type.
3. **Page-local source:** `source:"page"` dims/measures require `pageId` and pass the same
   per-page-field checks. (Entity-scoped editor only exposes entity fields + status; the server also
   accepts page-local from the records-page context.)
The UI mirrors these cosmetically, but the server is the boundary.

## Views role-visibility is a real server boundary
`views.visibleRoleIds` (null/empty = visible to all). Enforced server-side, not just UI:
- list endpoint filters out views the viewer's roles can't see,
- `GET /views/:id` returns **404** (not 403) for a role-invisible view,
- superAdmin override is explicit.
This replaces the old "clone a page per role" approach — one view, role-scoped visibility.

## Dim-type whitelist MUST stay in sync across client and server
`PIVOT_DIM_TYPES` exists in BOTH `artifacts/api-server/src/routes/records.ts` and the client
`entity-views.tsx`. If they drift, the UI lets an admin save a dim type the server rejects → the
pivot endpoint 400s at query time with no save-time error. **Why this bit us:** `phone` was added to
the client set but not the server set. Any change to one list must be made to the other in lockstep
(or refactored to a single shared constant).
**Important asymmetry:** the server `PIVOT_DIM_TYPES` set does NOT contain `relation`/`lookup` — those
are handled by an explicit branch BEFORE the whitelist check (see below). The client set DOES list
`relation`/`lookup`/`user` (it's only used to decide which fields to *offer* in the picker). So the two
sets are intentionally not identical for relation/lookup; keep `user` in both, and never "fix" the
server set by adding relation/lookup to it (that would route them through the wrong scalar expr).

## user / relation / lookup dimensions
- **user** dim: value is a scalar user id in `values_json`; `user` is in the server whitelist. A `user`
  DimMeta kind resolves ids → display names (`first last` || email) AFTER grouping (collect the row/col
  key sets, one `usersTable` lookup), and sorts by the resolved name. Falls back to the raw id.
- **relation / lookup** dims: these types store NOTHING in `values_json` — the displayed value is the
  projected `relatedFieldKey` of the single linked record. Use `relationValueScalar(meta)` (sibling of
  `relationValueExists` in `record-query.ts`) as the dim expr — a scalar correlated subquery with
  `LIMIT 1`. Built from `buildRelationMeta(entityId, visibleFields)` so (a) hidden relation fields are
  excluded (boundary) and (b) only SINGLE-link relations resolve (multi-link → clear Russian 400, since
  a scalar dim can't represent many links). Label = the projected value itself (key === label).
- **No new leak:** the projected value is already shown in the records table and already filterable via
  `relationValueExists`; pivoting on a *visible* relation field exposes nothing new. Page-local
  relation/lookup are explicitly rejected (their value isn't in `page_record_values`).
- This needed NO OpenAPI/codegen change: the pivot dim schema is `{source,fieldKey,datePeriod}` with no
  field-type enum, so new dim types are purely a server+client-picker concern.

## Measure / grouping mechanics
- Measure is `count` (rows) or `sum` (over a numeric field); sum uses a regex-guarded numeric cast
  (`PIVOT_NUMERIC_RE`) so non-numeric JSONB values can't throw `::numeric` errors.
- Date/datetime dims expose a period bucket (year/quarter/month/day) via `date_trunc`.
- Optional second (column) dimension makes it a 2D cross-tab; `__all__` sentinel is the single-column
  case. Row totals, column totals, and a grand total are computed.

## GROUP BY must use SELECT output ordinals, never re-embedded fragments
The grouped aggregation MUST `groupBy(sql\`1\`[, sql\`2\`])` (output-position ordinals), NOT
`groupBy(rowKeyExpr, colKeyExpr)`. **Why this bit us:** a dim like `values_json ->> key` is a Drizzle
`sql` fragment with a bound placeholder. Embedding the SAME fragment in both SELECT and GROUP BY
re-binds it to a *different* `$N` each time (`->> $1` in SELECT vs `->> $10` in GROUP BY), so Postgres
treats them as two different expressions → `column ... must appear in the GROUP BY clause`. The bug was
invisible for status dims (a bare column ref, `statusId::text`, has no placeholder to re-number) so only
entity-field/page-field dimension pivots 500'd. Same family as the dependent-filters "reused sql frag
re-binds params" gotcha — prefer ordinal references when the same dim expr must appear twice.
