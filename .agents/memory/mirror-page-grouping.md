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

## Client rules (EntityRecords)
- `groupingActive = groupByFieldKey set && !setupMode` (setup mode always flat).
- Expanded group's rows come through the SAME query path (inline edit, pagination unchanged); `numericTotals` while expanded = that group only (accepted).
- Add-row hidden in grouped mode; pagination footer hidden while nothing is expanded; `groups` state `null` = server declined → render flat.
- Group label render: `g.label ?? g.key ?? t("records.groupEmpty")`.
