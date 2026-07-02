---
name: Pivot report mode (Сводная таблица)
description: Durable invariants for the entity-based interactive pivot view type — its opt-in gates, permission scoping, and the dim-type whitelist that must stay in sync.
---

# Pivot report mode — durable decisions

Pivot started as a **view type** (`viewType: "pivot"` in a saved View's `configJson`) reusing the
Views engine + the live records filter bar (Records page shows a Таблица⇄Сводная toggle, gated on the
entity's `pivotEnabled` flag). It now ALSO exists as a dedicated **page type** — see "Pivot PAGE type"
below — which has a fundamentally different permission model.

## Pivot PAGE type (dedicated page) — ADMIN-AUTHORITATIVE
A page can be `isPivot=true` with `pivotEntityId` + `pivotConfigJson`. This is mutually exclusive with
dashboard ⊥ mirror ⊥ bound-entity, enforced on BOTH create (POST) and update (PUT) against the
effective final state. Compute endpoint: `GET /pages/:id/pivot/data`.
**Unlike the entity-based pivot view, the pivot PAGE is ADMIN-AUTHORITATIVE** (real totals over ALL
the entity's records, the SAME for everyone with page access — NOT scoped to the viewer's row/field
perms). The ONLY boundary is page access: `getPermissions` is checked BEFORE any aggregation, then
`entity.isActive` + `entity.pivotEnabled` are re-checked at compute time, then the WHERE is built from
ALL active fields (no hidden-field/own-row scoping) over non-archived records.
**`pivotConfigJson` shape:** `{ source:"entity"|"view"|"custom", viewId?, pivot?, filters?,
filterConjunction?, statusIds?, search? }`. NO `sorts` — a pivot returns an aggregated cross-tab whose
row/col ordering is decided by the pivot itself, so a record-level sort is a no-op (product decision:
omit the sort control on pivot pages, keep only filters/search/statuses). `source:"view"` re-validates
the view belongs to the same entity AND is `viewType==='pivot'` with a non-null pivot, else degrades to
an empty result. Invalid stored config (e.g. a field lost its pivot opt-in) → empty result, never a
page-level error.

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

## Multi-measure mode (several value columns) XOR a column dimension
A pivot can carry `measures: PivotMeasure[]` instead of a single `measure` + `cols`. The two are
**mutually exclusive by design** (user-approved): when `measures.length > 0`, multi-measure mode wins
and any `cols` dimension is ignored. Each measure becomes its own column.
- **Save/load round-trip rule (back-compat):** clients always edit as a `measures[]` draft list, but
  SAVE collapses `length === 1` → single `measure` (+ optional `cols`), and `length > 1` → `measures`
  (no cols). LOAD reads `config.measures ?? [config.measure]`. This keeps every pre-existing
  single-measure pivot byte-identical. The shared `PivotMeasuresEditor` + its
  `measuresFromConfig`/`buildMeasureConfig` helpers are the single source of this rule across all three
  surfaces (named view, entity default pivot, dashboard widget).
- `PivotConfig.measure` is therefore **optional** in OpenAPI + `PivotConfigInput` (absent in multi
  mode). The single path defaults to `{agg:"count"}` defensively so an empty/legacy config never throws.
- Each measure has a `key` (stable colKey + calc ref target; defaults to `m${i}`) and an optional
  multilingual `nameJson` column-label override (falls back to per-agg default; legacy `formulaName`
  still honored). Duplicate keys are rejected server-side.
- **`multiMeasure: true` suppresses row totals + grand total** (columns are heterogeneous measures, so
  a cross-measure row sum is meaningless). Per-measure **column** totals ARE kept. Frontend hides the
  row-total column and grand-total cell when `result.multiMeasure`.

### `calc` measure = formula over OTHER measures' aggregated per-row values
A new `calc` agg computes per row using a formula that references other measures by their colKey via
`{colKey}` (the same `{...}` token the formula evaluator uses). Evaluated AFTER all value
(count/sum/formula) measures are aggregated, in config order, so a calc may reference any value measure
(any position) plus any calc defined EARLIER in config order; its result is then itself referenceable.
- `calc` is valid ONLY in multi-measure mode (single-measure `calc` is rejected on every surface).
- **Fail-fast ref validation is the single boundary in `computePivot` (covers BOTH the records pivot
  route — which has NO save-time validator — and the dashboard widget).** Reject: all-calc configs (no
  value measure to compute over), self-references, and unknown/forward references. **Why:** an unknown
  `{ref}` silently collapses to 0 at eval time → wrong totals with no error. `pivotFormulaRefs(expr)`
  (exported from `pivot-compute.ts`) extracts `{...}` refs; `dashboard.ts validatePivotConfig` reuses it
  for earlier save-time feedback, but compute-time is the authoritative gate.
- calc column total = sum of its per-row calc values (consistent with other measures' column totals).

## Measure / grouping mechanics
- Measure is `count` (rows), `sum` (over a numeric field), or `formula` (per-record expression).
  sum uses a regex-guarded numeric cast (`PIVOT_NUMERIC_RE`) so non-numeric JSONB values can't throw
  `::numeric` errors.

### Formula measure — evaluate-per-record-then-sum (NOT a SQL aggregate)
- A `formula` measure does NOT push into Postgres. It runs a NON-grouped query selecting (rowKey,
  colKey, valuesJson), evaluates the admin's expression once per record (same `evaluateFormula` engine
  as `function` fields), sums the finite numeric results into each (rk,ck) cell client-side in the
  handler. **Why:** the use case is `metres * pricePerUnit` per item, then SUM of per-item totals —
  this is impossible as a single SQL sum because the product is computed per row first.
- **Hard field boundary is the per-row value map, NOT SQL.** Build the eval value map restricted to
  `allowedKeys` = the pivot-enabled keys of the `entityFields` list passed in. Because `entityFields`
  is already the caller's boundary (viewer-visible set on the records path; all-active on the
  admin-authoritative dashboard path), hidden/non-opted fields are simply ABSENT from the eval context
  → a `{key}` reference to them returns null, never leaks a value. Do not feed raw `valuesJson` to the
  evaluator.
- Validate the expression ONCE up front via `evaluateFormula(expr, {})` (missing fields return null;
  only true parse errors throw → reject the whole request). Per-record runtime anomalies must NOT
  fail the request — a non-finite/throwing record contributes 0, keeping the pivot resilient.
- Empty formula is rejected at three layers: both client editors (named-view + default pivot in
  entity-views, and the dashboard `PivotEditor`) AND server (`computePivot` + dashboard
  `validatePivotConfig`). The agg select offers `Формула` on all three surfaces; refs come from the
  pivot-enabled numeric/visible field set (`pivotSumFields` / `sumFields`).
- A formula measure has no field, so its single-column header (the `__all__` no-cols case) would read
  the literal "Формула". The measure carries an optional multilingual `formulaName` (oneOf
  MultilingualText|null) used as that header, falling back to "Формула" when empty. It is a pure
  DISPLAY label (becomes `measure.label`) — never touches SQL/filtering/auth, so no boundary concern.
  Persisted via a `cleanML()` helper on each client surface that drops empty locales → null.
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

## Pivot as a DASHBOARD WIDGET — admin-authoritative twin of the records pivot
A `widgetType: "pivot"` dashboard widget renders the same cross-tab, but with the OPPOSITE
permission model from the records-page pivot above. Config = `WidgetPivotConfig {entityId, pivot:
PivotConfig, statusIds?}` on `WidgetConfig.pivot`.

**Shared compute core.** Both paths call the SAME `computePivot()` in `pivot-compute.ts` (extracted
from the old inline records handler). The caller supplies the boundary via the `where` SQL + the
`entityFields` list:
- Records path (`records.ts`): perm-scoped — visible fields only, own-scope, hidden-status, page-local.
- Dashboard path (`computePivotWidget` in `dashboard.ts`): **admin-authoritative** — ALL active fields,
  `buildRelationMeta(entityId, allFields)`, `where = entityId + isNull(archivedAt) + optional statusIds`.
  No own-row / hidden-field / hidden-status scoping (like `computeMetric`/`computeChartSeries`).

**Access is gated BEFORE compute, not inside it.** The GET dashboard/data handler checks page access +
per-widget `visibleRoleIds` and only computes widgets the viewer may see. So the widget's real totals
never reach an unauthorized viewer even though compute itself bypasses data RBAC.

**The entity `pivotEnabled` opt-in must be re-checked at COMPUTE time, not only at create/update.**
`validatePivotConfig` checks `entities.pivotEnabled` when saving a widget, but `computePivotWidget` MUST
also re-load and re-check it (return `null` ⇒ `pivot:null`) so that disabling pivot for an entity later
stops existing widgets from computing. Same spirit as `computePivot` returning null when a field loses
its per-field opt-in.
**Why:** create-time validation is not a durable boundary — entity config changes after the widget is
saved, and a stale opt-in would otherwise keep producing pivots over a now-disabled entity.

**Dashboard pivots reject page-local sources.** `computePivotWidget` builds a plain entity boundary with
NO page context, so `source:"page"` dims/measures can't resolve there. `validatePivotConfig` hard-rejects
page-sourced rows/cols/measure for dashboard widgets (the records pivot still accepts page-local from the
records-page context). The client `PivotEditor` only ever emits entity/status dims + entity sum measures.

**Client (`DashboardView.tsx`).** `PivotEditor` mirrors the entity-views `PivotDimEditor`; `draftToDim`
trusts the editor-maintained invariant that `datePeriod` is non-null only for date-like dims (no field-type
re-resolution in the parent `buildData`). `PivotResultTable` (presentational, extracted from `PivotView.tsx`)
is shared between the records pivot and the widget render branch.

## Default-pivot role visibility — viewId is a server-validated capability token
The entity DEFAULT pivot (`entities.defaultPivotJson`, the Таблица⇄Сводная toggle with no named
view) carries its own `visibleRoleIds` (super passes; empty = everyone with record access), enforced
in the `POST /entities/{id}/records/pivot` endpoint. The request's `viewId` is **untrusted** and must
NEVER be used as the mere branch condition (presence of `viewId` to skip the default gate is a bypass:
a disallowed caller could send a bogus/foreign/non-pivot `viewId`). The endpoint MUST:
- `viewId != null` → load the view and require ALL of: `view.entityId === entityId`, the view is a
  pivot view (`configJson.viewType === "pivot"` && `configJson.pivot != null`), AND role-visibility
  (super OR empty `visibleRoleIdsJson` OR intersection with the viewer's `roleIds`); else **404**.
- `viewId == null` → enforce `defaultPivotJson.visibleRoleIds` (else 403).
**Why:** so `viewId` acts as a server-validated capability token for "named-pivot mode"; only a visible
pivot view (an admin-authored, role-gated pivot surface) lets a caller out of the default-pivot gate.
Body `pivot` is intentionally NOT required to equal `view.configJson.pivot` — this endpoint is
permission-scoped at compute, so it leaks nothing the viewer can't already read, and the live filter
bar is meant to drive the config. Role visibility here is a PRESENTATION gate, not a data boundary.

## Page-local fields as pivot dims/measures (all three admin-authoritative surfaces)
The pivot widget, pivot PAGE custom config, AND the dashboard table widget can now use page-local
("поля страницы") fields, via an explicit `pageId` carried in the config (`WidgetPivotConfig.pageId`,
`PivotPageConfigValue.pageId`, `TableConfig.pageId + pageFieldKeys`). Durable rules:
- The `pageId` MUST resolve to a page of the SAME entity (its bound page or a mirror page) —
  validated on save ("Page X does not belong to entity Y") and mirrored in the UI page picker.
- Page dims/measures use `source:"page"` in the dim/measure; pivot gates re-check page-field
  `pivotEnabled` (+ isActive) at COMPUTE time → opt-in loss degrades to an empty result, never an
  error. Table page columns require only `isActive` (no pivotEnabled gate — table shows raw values).
- Table page columns come back as synthetic `__pf_${key}` columns resolved from `page_record_values`.
- Client persists `pageId` only when a page dim/measure actually uses it (`usesPage` check), and
  changing/dropping the page context resets page-sourced dims/measures in the editor.
- `DraftDim.source` gained `"page"` in the shared ViewConfigEditors; `PivotDimEditor` takes an
  OPTIONAL `pageDimFields` prop (default `[]`, options namespaced `p:<key>`) so entity-views editors
  stay entity|status-only — back-compat by default, page support only where a page context exists.
- Multi-entity note: page-local fields + relation/lookup dims are the sanctioned "multiple entities"
  coverage; a true multi-entity UNION pivot is explicitly out of scope.
