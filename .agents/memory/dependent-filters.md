---
name: Dependent record filters
description: Records-page filter bar — isFilterable opt-in, status quick-filter, and dependent option lists; plus the SELECT DISTINCT + ORDER BY param-reuse gotcha.
---

# Dependent record filters (EntityRecords)

The records page has a filter bar: free-text search, a status quick-filter (multi-select on
`entityRecords.statusId`), and one dependent dropdown per field opted into filtering.

## Opt-in
A field appears in the live records filter BAR only when `entity_fields.isFilterable = true` (default
false), toggled from the field config dialog. Hidden fields never appear (filterable list derives from
the visible-form fields).

**`isFilterable` is a live-bar UI opt-in, NOT a security boundary.** `/records/filter-values` gates on
`!target` (field must be VISIBLE), not `!target.isFilterable`. The real boundaries are field visibility
(`visibleFields`/hidden) + row scope (own) + hidden-status — all applied below regardless. The live bar
only ever requests filterable fields so its behavior is unchanged, but the admin VIEW-CONFIG editor
needs distinct values for ANY visible field (incl. non-filterable relation/lookup fields like a `file`
lookup), so it must not be blocked by the `isFilterable` flag.

## View-config editor value pickers must mirror the live bar
The `/admin/entity-views` editor (both DEFAULT-view and named/additional-view dialogs) renders a
per-field filter value picker. It MUST resolve the same way as the live records bar (EntityRecords),
not with a bespoke picker:
- Compute `effectiveType`: relation/lookup field → the PROJECTED linked-field type (looked up via a
  `projectedTypeByField: Map<fieldKey,fieldType>` built from `useListEntityRelations` +
  `useQueries(getListEntityFieldsQueryOptions)` over the linked entities); otherwise the field's own type.
- Route user / relation / lookup / any discrete-operator field through the SHARED `ValueChecklistPicker`
  (same component the live bar uses) with `labelFor` resolving user id→name (via the userOptions map) and
  boolean→Да/Нет; `allowManual` disabled for user/boolean. select→OptionPicker, date→calendar as before.
**Gotcha:** there are TWO `FilterRowsEditor` call sites (default-view + named-view) with DIFFERENT
conjunction handlers, so a `replace_all` keyed on the conjunction prop only patches one. The
`projectedTypeByField` prop must be passed to BOTH, or relation/lookup user-id→name resolution silently
falls back to `text` in whichever dialog was missed.

## Dependent option lists
Endpoint `POST /entities/{entityId}/records/filter-values` (operationId `getEntityFilterValues`,
POST-body only to dodge the Orval param-collision gotcha) returns distinct values of one field among
records matching the OTHER active filters. Self-exclusion is enforced on BOTH sides: the client drops
the target field from the ad-hoc filters it sends, and the server defensively strips any filter on the
target field before building SQL. The endpoint reuses the exact query access boundary (`view` perm +
row scope + field-hidden + whitelist-validated bound params).

**Why both sides:** option lists must reflect what the *other* filters narrow to, never the field's own
current pick (which would make it impossible to widen a selection).

## Conjunction must match the query
`getFilterOptions` MUST send the SAME `filterConjunction` as the records query
(`selectedConfig.filterConjunction ?? "and"`), not a hardcoded "and". A view can be OR-configured; if
the option fetch used AND while the table used OR, the dropdowns would offer values inconsistent with
the displayed rows.

## Date/datetime fields filter via a calendar + a single `between` condition
A filterable date/datetime field renders a calendar popover (single day or range) plus presets
(today / 7d / 30d / this month / last month / this year / max=clear), NOT the distinct-value
dropdown. The picked range is sent as ONE `between` filter condition with `value=[from, toExclusive]`
(half-open `[from, day-after-to)`), never as two `gte`+`lt` conditions.
**Why one condition, not two:** ad-hoc filters are flattened into the records query under the
view's `filterConjunction`. Two separate `gte`/`lt` conditions would be OR-combined under an
OR-configured view (matching nearly everything). A `between` condition is internally AND, so it
stays correct under any conjunction. The server's `buildCondition` implements `between` type-aware
(timestamptz for dates, numeric for numbers, text otherwise).
**How to apply:** any "range" filter (date or numeric) should be a single internally-AND operator,
not a pair of conditions, because the surrounding conjunction is not guaranteed to be AND. Active
date filters must also be fed into `getEntityFilterValues` (self-excluding the target field) so the
dependent dropdowns narrow by the date range too.

## relation/lookup fields participate in search AND filters (no values_json entry)
`relation`/`lookup` fields store NOTHING in `values_json`; their displayed value is the LINKED
record's `valuesJson[relatedFieldKey]` reached through `record_links`. So free-text search and the
filter bar must resolve them through the link, not the text expression.
- `record-query.ts` exposes `relationDirection(relation, entityId)` (single source of truth for which
  side the base row sits on: "source" for source-side one_to_one/many_to_one, "target" for target-side
  one_to_one/one_to_many) and `RelationFilterMeta {relationId, relatedFieldKey, direction}`.
- `buildRecordQuery(fields, spec, relationMeta)` takes a `fieldKey → RelationFilterMeta` map. For any
  field in that map it matches/searches via a correlated `EXISTS` over `record_links` + the linked
  `entity_records`, instead of `values_json ->> key`. Search adds these EXISTS-ILIKE chunks for every
  relation/lookup field that has meta.
- `buildRelationMeta(entityId, visibleFields)` in `records.ts` builds that map ONLY for VISIBLE
  relation/lookup fields whose direction resolves (null direction = excluded). It must be passed to
  EVERY `buildRecordQuery` caller (query, filter-values, dependent-values, rename-value) so relation
  filters work uniformly.
**Boundary:** the map is built from `visibleFields`, so a hidden relation field can never become
searchable/filterable — same field-hidden boundary as stored fields. Distinct option values for a
relation/lookup target reuse the EXACT base-row boundary (entity/archived/own-scope/hidden-status +
other active filters); only links reachable from visible base rows contribute (= same exposure as the
rendered column, no new leak).
**SQL alias rule:** the inner EXISTS subquery aliases `record_links rl` / `entity_records lt`; the
filter-values DISTINCT path joins with DIFFERENT aliases `record_links frl` / `entity_records flt` to
avoid shadowing. Pick `frl.source_record_id`=base / `frl.target_record_id`=linked for direction
"source", inverse for "target".

## Page-local fields participate in the filter bar via a separate channel
Page-local fields (values live in `page_record_values.values_json`, keyed by fieldKey, NOT the
record's own `valuesJson`) can opt into filtering with `page_fields.isFilterable` (default false).
They ride a DEDICATED `RecordQuery.pageLocalFilters: FilterCondition[]` channel, never mixed into the
normal `filters` array — this keeps page-local vs entity fieldKey collisions harmless (separate code
paths) and lets the server validate/scope them independently.
- **Server (`/records/query`)** requires `pageId`, loads active page fields, and accepts a page-local
  filter ONLY when the field is `isFilterable`, a value-backed type, AND not hidden for the caller's
  roleIds (`mostPermissiveFieldPerm(...,"view") !== "hidden"` — superAdmin/pages-admin get NO pass
  here; this is the hard inference-leak boundary). Conditions are built via
  `buildPageLocalCondition(cond, fieldType, pageId)` → `buildCondition(cond, type, pageLocalValueExpr)`,
  where `pageLocalValueExpr(pageId,key)` is a CORRELATED subquery
  `(SELECT prv.values_json ->> key FROM page_record_values prv WHERE prv.page_id=? AND prv.record_id=entity_records.id)`
  passed as `buildCondition`'s `exprOverride` (default expr is the normal `textExpr(field)`).
- **Client (EntityRecords)** scopes the page-local filter UI to types `select`/`boolean`/`date`/`datetime`.
  Boolean is a fixed `["true","false"]`; date/datetime reuse the same half-open `between` range pattern
  as entity date filters. For everything else (select), the dropdown shows the DISTINCT EXISTING values
  actually present in the table — NOT the field's static `optionsJson` — so an option no record uses is
  never offered. There is still NO *dependent* (cross-filter) narrowing for page-local options; the
  values just reflect what is stored.
- **Existing-values endpoint:** `POST /entities/{entityId}/records/page-filter-values` (op
  `getPageFilterValues`, body `{pageId, field, archived?}` → reuses `FilterValuesResult`). It mirrors the
  EXACT `/records/query` page-local read boundary (requireRecordParam view + entityExists + page-field
  lookup by `(pageId,isActive)` + `isFilterable && PAGE_LOCAL_FILTERABLE_TYPES.has(type) &&
  mostPermissiveFieldPerm(...,"view")!=="hidden"` with NO super bypass), then runs
  `selectDistinct({v: valuesJson->>field})` over `entity_records INNER JOIN page_record_values ON
  (page_id, record_id)` with `eq(entityId)` + `archivedWhere` + `ownScopeWhere` (when scope=own) +
  `hiddenRowStatusWhere` + value-non-empty, `.orderBy(sql`1`)` (the ordinal gotcha below), `.limit(500)`.
  Cross-entity safe because `entity_records.id` is a global PK so a mismatched page row joins to nothing.
  Client `getPageFilterOptions` calls it for non-boolean and returns `[]` when `permPageId` is null.
- **Client visibility must match the server boundary:** `filterablePageFields` ALSO drops any field
  hidden for every assigned role (same per-role display-only hide as `tableFields`, applied even to
  admins). Without this, a pages-admin — who receives hidden page-fields from `GET /pages/:id/fields`
  for setup mode — would see a filter the `/query` endpoint then 400s on. Never offer a page-local
  filter the server would reject.

## SELECT DISTINCT + ORDER BY gotcha (the bug that cost the most here)
Building the distinct query as
`db.selectDistinct({ v: valueExpr }).orderBy(asc(valueExpr))` FAILS at runtime in Postgres.
**Why:** each interpolation of the same `sql` template (`(values_json ->> ${field})`) emits a FRESH
bound-param placeholder ($1 in SELECT vs $5 in ORDER BY). Postgres then treats the ORDER BY expression
as a different expression than the selected column and rejects it ("ORDER BY must appear in select list"
for DISTINCT). The drizzle/HTML error wrapper only shows "Failed query …", not this reason.
**Fix:** order by ordinal — `.orderBy(sql`1`)` — so it references the single selected column.
**How to apply:** never re-interpolate the same `sql` fragment in both the SELECT-distinct column and
its ORDER BY; order by ordinal or by the column alias.
