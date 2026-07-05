---
name: Mirror-page grouping
description: Grouped (accordion) records mode on mirror pages — server group buckets, group label boundary, client fallback rules.
---

# Mirror-page grouping (pages.groupByFieldKey)

A mirror page can set `groupByFieldKey` — a source-entity field (incl. a single-link relation/lookup) that turns the records table into collapsed group rows with server-computed count + sums, expandable accordion-style (one group at a time) into the normal inline-editable rows.

## Contract
- `pages.groupByFieldKey` (nullable). Valid only on mirror pages; validated on create AND update against the effective final state (non-mirror + explicit key → 400; page stops being mirror → silently nulled). Function/file fields rejected; relation/lookup must resolve to a single-link direction.
- Records query: `grouped: true` → response gains `groups: [{key, label, count, sums}]`; `groupValue: {value: string|null}` narrows the ROW set to one group. Both REQUIRE `pageId`.
- Groups are computed over the filtered set WITHOUT the `groupValue` narrowing — expanding one group still returns every bucket.
- Relation group: key = linked record id `::text` (opaque), label = projected `relatedFieldKey` value. Scalar group: key = label = stored value.
- NULL and `''` share one "no value" bucket, sorted last (client sentinel key `"\u0000__null__"`); other buckets sort `localeCompare(ru, numeric)`.

## Boundaries (hard, server-side)
- Group field hidden/unavailable for the viewer → `grouped` silently degrades (groups omitted), `groupValue` → 400. Client treats `groups === undefined/null` as "flat fallback".
- **Relation group LABEL carries its own boundary**: the projected linked-entity field is re-checked with the same gate as the related-values column (`canRecord(view)` on the linked entity + `resolveFieldAccess !== "hidden"`). If not allowed → `labelExpr = NULL`, label withheld, grouping still works via the opaque id key. Without this the group header would leak a projected value the rendered column itself hides.
- Group sums follow the numericTotals invariant exactly: only `showColumnTotal` columns (entity number/function + page-local `pf:${id}` fields, page-local ones permission-gated), summed over RAW stored values (true-total product decision), per-row rounding for formulas — so group sums reconcile with the flat column total.

## Group-common values (`RecordGroup.values`)
- A group row cell also shows the column's value when EVERY row in the group carries the SAME non-empty value (`null`/`''` never yields one; any mismatch or empty → no value). Keys mirror the sums keys (entity fieldKey / `pf:{id}`); sum-flagged columns are excluded (sum wins).
- Covered columns: entity scalars, function fields (evaluated per row), page-local value-backed fields (perm-gated), and relation/lookup projections. File columns skipped for entity/page-local (object values); relation projections that ARE files arrive as raw JSON text and the client detects them by shape.
- **Relation/lookup common values carry a STRICTER boundary than the group label**: besides `canRecord(view)` + projected field not hidden, the column is skipped entirely if the viewer has ANY row-level restriction on the linked entity (own scope or hiddenRowStatusIds) — the raw scalar projection cannot re-apply per-row visibility, so restriction ⇒ no common value at all. Related projected fields are batch-loaded in one query (no N+1).
- Client renders relation/lookup commons through the same synthetic relField as normal cells (`entityRelatedColMeta` + `knownRelatedFieldTypes` + optionsJson); the server projects via `->>` (TEXT), so booleans arrive as "true"/"false" and MUST be coerced before renderCellValue ("false" is truthy).
- Group counts reflect the ACTIVE UI filters (incl. the page's SOFT default quick-filter), so a group can legitimately show fewer rows than the raw record count — commons are computed over that same filtered set.
- `__status__` is a RESERVED group-values key: it carries the shared statusId when EVERY row in the group has the same non-null status (client renders the same tinted chip as row cells via statusById). No collision risk — user fieldKeys must match `^[a-z][a-z0-9_]*$`. Row boundary (hiddenRowStatusIds) is already applied before the commons pass.
- Conditional formatting applies to group commons: the first matching `formatRulesJson` rule colours the group cell like an individual cell — cellColor on the td (and passed into pinStyle so sticky cells stay opaque), textColor passed INTO renderCellValue (inner elements carry their own colour classes; an inherited wrapper colour never reaches them). Match against the same value shape as the per-row formatting path (parsed/coerced projected value for relation/lookup).

## Client rules (EntityRecords)
- `groupingActive = groupByFieldKey set && !setupMode` (setup mode always flat).
- Expanded group's rows come through the SAME query path (inline edit, pagination unchanged); `numericTotals` while expanded = that group only (accepted).
- Add-row hidden in grouped mode; pagination footer hidden while nothing is expanded; `groups` state `null` = server declined → render flat.
- Group label render: `g.label ?? g.key ?? t("records.groupEmpty")`.

## Expand-all mode + no-flicker refetch
- **No-flicker rule:** the records skeleton must gate on `recordsLoading && !hasLoadedRecords`, NOT `recordsLoading` alone. The records fetch is a MANUAL useEffect (`runQuery`, keyed on `JSON.stringify(recordQuery)+refreshTick`), not a react-query hook — so every inline edit / group toggle re-runs it. Gating on bare `recordsLoading` unmounts the whole table → flicker. `hasLoadedRecords` flips true once in the effect `.finally`. **Why:** keep the table mounted across refetches so inline edits and expand/collapse don't flash a skeleton.
- **Expand-all is a THIRD mode** alongside flat and single-accordion. State `expandAll` (bool) is mutually exclusive with `expandedGroupKey` (clicking a header while expandAll leaves expandAll and focuses that one group).
  - Query: send `withRowGroups: true` (NOT `groupValue`) → server returns `rowGroups` map (`recordId -> groupKey|null`) AND orders the data rows by group key (NULLS LAST) for contiguity. Because no `groupValue`, `numericTotals` + `groups.sums` stay full-filtered-set totals (correct).
  - Render: headers are INTERLEAVED with rows inside `records.map`, not the before/after split blocks (those are empty when expandAll). Emit `renderGroupRow(group)` before a row when the row's group key differs from the previous row's; wrap the row + optional header in `<Fragment key={record.id}>`. Look the group up in a plain `groupByKey` Map (`groupKeyOf(g)==null→NULL_GROUP_KEY`).
  - `groupByKey` is a **plain Map built inline, NOT useMemo** — adding a hook mid-body (after the many early-return effects/helpers above it) breaks rules-of-hooks ("Rendered more hooks than during the previous render", esp. under HMR).
  - The record-render condition AND the pagination footer condition must both include `|| expandAll` (else expandAll shows nothing / no pager).
  - **Pagination compromise (not a bug):** in expandAll the `records` page is still ONE PAGE_SIZE window across ALL groups, while each header's count/sums are full-group totals. Coherent with the existing `groups` contract.
- Expanded header highlight: saturated fill `#e0e7ff` + inset indigo left accent `shadow-[inset_3px_0_0_0_#6366f1]`; collapsed stays pale `#f8fafc`. Toolbar toggle button visible only when `showGroups && !setupMode`, i18n `records.expandAllGroups` / `records.collapseAllGroups`.
