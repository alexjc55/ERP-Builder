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
