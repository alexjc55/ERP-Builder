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
**Invariant:** the editor renders TWO `FilterRowsEditor` instances (default-view + named-view) that
must receive IDENTICAL shared props (`projectedTypeByField`, `getOptions`, …). They have different
conjunction handlers, so they are easy to edit out of sync — any new shared prop must be wired to BOTH
or behavior silently diverges between the two dialogs.

### Filter operators must be scoped by EFFECTIVE field type
The operator dropdown must not offer operators that are meaningless for the field's
type (a `user`/`select`/`boolean` filter offering "содержит"/"больше" is nonsense).
`operatorsForType(effectiveType)` filters the master `FILTER_OPERATORS` list: closed
types (user/select/boolean) → equality only (eq/neq/in/empty); number/date → ranges
(gt/gte/lt/lte) but no substring; text/unmapped → the full set. Effective type resolves
relation/lookup → projected linked-field type (fallback `text`). Both `FilterRowsEditor`
instances compute it per row. **Invariant:** when the row's FIELD changes, reset the
operator to `eq` if the current operator isn't in the new type's allowed set, and clear
the value — otherwise a stale invalid operator (e.g. "содержит" carried onto a user field)
survives. `eq` is in every type's list, so it's always a safe reset target.
**Edge:** projected types load async; before they resolve a relation field falls back to
`text` (full operator set). Accepted — operators don't auto-correct after load, only on
explicit field change.

### shadcn Select popper Viewport clips scroll
The shadcn `ui/select.tsx` `SelectPrimitive.Viewport` shipped with
`h-[var(--radix-select-trigger-height)]` in its `position==="popper"` class. That pins the
list height to the TRIGGER height (~32px), so long dropdowns are clipped and unscrollable
even though `SelectContent` has `max-h-[--radix-select-content-available-height]` +
`overflow-y-auto`. Fix = drop the `h-[…]` token (keep `w-full min-w-[…trigger-width]`).
**Why:** the Content's overflow can only scroll if the Viewport is allowed to grow taller
than the trigger. This is app-wide (every `Select`), not filter-specific.

### View-editor pickers offer the FULL domain, not existing values
A saved view filter is a RULE that must also match records created LATER, so the view-config value
picker must NOT be limited to values already present in the data (that's the live-bar's dependent
semantics, which is wrong for authoring). The page passes a single `getDomainOptions(fieldKey)` to the
editors that branches on the EFFECTIVE type (relation/lookup → projected linked-field type):
- **Closed domains** return the full set, ignoring records: `user` → all `userOptions` ids;
  `boolean` → `["true","false"]`; `select` → the field's (or projected linked field's) `optionsJson`.
- **Open domains** (text, number, relation/lookup→text) fall back to the distinct EXISTING values
  endpoint as mere SUGGESTIONS, and `allowManual` stays ON so an author can type a not-yet-present value.
`allowManual` is OFF for closed domains (user/boolean/select) — picking from the full list is the point.
Native `select`/`boolean` short-circuit to OptionPicker / Да-Нет before the checklist; `getDomainOptions`
only matters for `user` and relation/lookup-projected closed domains.
**Why this mattered:** an admin couldn't build a view filtering by a manufacturer (a `user` lookup) that
had no records yet — the picker only listed users already used, with manual entry disabled.
**Stability:** `getDomainOptions` must be a stable `useCallback` (ValueChecklistPicker's fetch effect
depends on it); building it per-render would refetch in a loop while the popover is open.

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

### Calendar highlights days that have records
The date popover highlights, in the calendar, the days that actually have records (so users don't
pick empty days). It reuses the SAME distinct-values fetch as the dropdowns — entity fields →
`getEntityFilterValues` (filter-aware: narrows by the OTHER active filters, self-excluding the
target), page-local fields → `getPageFilterValues`. The fetched stored values are bucketed to
local-day granularity and passed as react-day-picker `modifiers`. The availability fetcher MUST be
a stable reference (it's an effect dep keyed on `open`); fetch on open, guard with a cancelled flag.
**Known asymmetry (intentional):** page-local highlighting reflects ALL stored record-days for the
field, NOT narrowed by other active filters — same deliberate no-dependent-narrowing rule the
page-local dropdowns already follow. Making it filter-aware needs new params on `getPageFilterValues`.

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
**Route the live filter bar by the PROJECTED type, not the field's own type.** A relation/lookup
field that projects a date must open the date CALENDAR, not the value checklist. The client computes
an `effType` (relation/lookup → the projected `relatedFieldType` from the entity-related-columns
meta, fallback `text`) and branches the calendar-vs-checklist on `effType`. Consequently
`buildRelationCondition` MUST implement every operator the projected type can emit — including
`between` (the calendar's only operator). Its `::timestamptz` cast on the linked value must be
CASE-guarded by a date-prefix regex so an empty/malformed linked value (the EXISTS scans many linked
rows) yields no-match instead of a 500.
**The projected type must be sticky.** `relatedFieldType` is only available from the related-values
fetch, which CLEARS its columns whenever the current filter returns zero rows. So routing read live
off that meta would flip a lookup-of-date field back to the checklist as soon as you filter to an
empty day/period. Cache `relatedFieldType` per fieldKey (accumulate, never clear on empty; reset on
entity switch) and use it as the routing fallback so the calendar persists across empty results.

## Page-local and computed page fields use a separate filter channel

Page fields ride a dedicated `pageLocalFilters` channel so a page key can never collide with an
entity key. A field appears in the live filter bar only when it is active, visible to the viewer, and
its own `isFilterable` flag is enabled. `showInTable` is independent: a hidden column is not
automatically a filter, but it may be an opt-in filter.

Stored scalar page values can compile directly to SQL. Formula, relation, lookup, and eligible
`page_ref` targets are materialized at read time over the complete permission-scoped candidate set;
the matching record IDs narrow the authoritative query before count, pagination, grouping, totals,
and pivot computation. Computed values are never persisted.

**Why:** users need filters such as “Customer” without displaying an extra table column, while
pagination and totals must still describe every matching row rather than only the current page.

**How to apply:** every new computed filter target must reuse the same resolver as its displayed
value and reapply page access, record view, own/filter row scope, hidden statuses, and field
visibility at every source or relation hop. A `page_ref` requires both destination-field and
source-page/source-field authorization. Group-result formulas remain ineligible because a linked or
filtered subset cannot choose the full-set winner correctly.

Linked relation/lookup choices use the linked record ID as stable equality identity and the projected
value only as the display label. Duplicate labels must remain distinct, label renames must not break
saved selections, and text search/operators use the decoded display value. Full-set ID predicates
must use an array-bound parameter or safe batching rather than one SQL placeholder per record.

The existing-values endpoint follows the same boundary and filterability gate. Stored values use the
direct distinct-value path; computed targets use the protected read-time materializer. Any capped
option list must search before the limit, including Unicode labels.

Formula filter labels may inherit user identity only from proven direct field references, never
from a numeric result alone.
**Why:** a customer-reference formula produces an ID, but arithmetic can produce the same number;
guessing from the result would mislabel numeric reports as people.
**How to apply:** preserve raw-ID comparisons while resolving display names through the existing
user-directory boundary; name search must happen before the option limit.

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

## Collapse default (2026-07-18)
- The quick-filter bar can be collapsed/expanded by default per page (`pages.filters_collapsed_default`), mirroring the Analytics `widgetsCollapsedDefault` pattern: viewer localStorage override (`erp.filters.collapsed.<pageId|e<entityId>>`, "1"/"0", null → admin default), setup-mode Select saves via page PUT (pages cap). Display-only, never a data boundary.

## Filter-values 500-row limit needs server-side picker search (2026-08)

Both filter-values endpoints (entity + page-local) cap DISTINCT values at 500
ordered alphabetically. With >500 distinct values a value outside the first 500
was unfindable — the picker's search box only filtered the fetched list, and
after switching the archive toggle to "all" the same selection silently emptied.
Fix: optional `valueSearch` in the request, applied as ILIKE on the value
expression BEFORE the limit; ValueChecklistPicker debounces its search box and
passes it as getOptions' second arg. Any new value-list endpoint with a row cap
must accept the picker search server-side.

## "(Пусто)" filter option

- Filter-values endpoints (entity stored, relation/lookup, page-local) prepend sentinel `__empty__` (EMPTY_FILTER_VALUE in record-query.ts, literal duplicated in FilterValuePicker.tsx) when a visible row has no stored value; probe reuses the SAME boundary clauses (own-scope/hidden-status/archive), skipped while valueSearch is set.
- `in` conditions translate the sentinel: stored/page-local → `(expr IS NULL OR expr='')` OR-combined inside the single condition; relation/lookup → `NOT EXISTS` non-empty linked value. Never widens other AND conditions.
- Known accepted risk: a REAL stored value literally `__empty__` would be reinterpreted as "empty" (same convention as other `__x__` system keys — treated as a reserved keyspace, not enforced at write paths).
