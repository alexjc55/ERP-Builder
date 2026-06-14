---
name: Dependent record filters
description: Records-page filter bar — isFilterable opt-in, status quick-filter, and dependent option lists; plus the SELECT DISTINCT + ORDER BY param-reuse gotcha.
---

# Dependent record filters (EntityRecords)

The records page has a filter bar: free-text search, a status quick-filter (multi-select on
`entityRecords.statusId`), and one dependent dropdown per field opted into filtering.

## Opt-in
A field appears as a filter only when `entity_fields.isFilterable = true` (default false), toggled
from the field config dialog. Hidden fields never appear (filterable list derives from the visible-form
fields).

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
