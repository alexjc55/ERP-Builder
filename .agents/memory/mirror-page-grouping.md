---
name: Mirror-page grouping
description: Visual grouping on mirror pages — stable paginated snapshot, local expansion, server buckets and security.
---

# Mirror-page grouping (pages.groupByFieldKey)

A mirror page may visually group records by a source-entity field, including a single-link relation/lookup. Group headers contain server-computed counts, sums and common values.

## Contract and boundaries
- `pages.groupByFieldKey` is valid only on mirror pages; validate create and update against the effective final state. Non-mirror + explicit key is rejected; changing away from mirror silently clears it. Function/file fields are rejected and relation/lookup must resolve to a single-link direction.
- `grouped: true` returns `groups: [{key, label, count, sums, values}]`; `withRowGroups: true` supplies membership (`recordId -> groupKey|null`) and clusters page rows by group. Both require page context. The API still supports `groupValue` for other consumers, but the records table no longer uses it.
- Groups cover the full filtered set. Relation key is opaque linked-record ID text; label is projected relatedFieldKey value. Scalar key/label is stored value; NULL/empty share one bucket sorted last (client sentinel `"\u0000__null__"`).
- Primary `__created_at__` sort orders groups by newest/oldest member; otherwise applicable group-field/sum/common sort, then label numeric locale order.
- Hidden/unavailable group field degrades `grouped` to flat (groups omitted). Existing server `groupValue` requests reject that field. Client must render flat when groups is null/undefined.
- Projected relation labels require linked-entity record-view permission AND non-hidden projected field. Withhold only the label when denied; opaque grouping key can remain.
- Row visibility, status restrictions and field permissions remain enforced server-side.
- Group sums use configured showColumnTotal columns and permission-gated page `pf:${id}` keys, RAW stored numeric values, and per-row formula rounding. Never infer the server numericTotals from sums or visible rows.
- **Drizzle membership qualification:** the rowGroups SELECT must wrap its key fragment in `sql` rather than selecting a raw fragment. Otherwise a correlated relation subquery's unqualified `"id"` may resolve to `rl.id`, silently mapping every row to NULL. See drizzle-select-fragment-qualification memory.

## Group-common values
- A common value exists only when every group member has the same nonempty value; null/empty/mismatch yields none. Keys are entity fieldKey / `pf:${id}`, excluding sum-flagged columns (sum wins).
- Supported: entity scalars/functions, permitted page values, relation/lookup projections. File columns excluded; projected files can arrive as raw JSON text, detected by shape.
- Relation commons require record-view plus nonhidden target field, and are entirely withheld if the viewer has ANY linked-entity row restriction (own scope/hiddenRowStatusIds). Projection cannot safely reproduce linked row visibility. Batch load, no N+1.
- Render projected commons using synthetic related field type/options. Coerce projected boolean strings: `"false"` is otherwise truthy.
- Reserved `__status__` common carries a shared non-null statusId; render the same status tint and tag caption. Real field keys cannot collide.
- Apply the first matching formatting rule to common values, with cell colour passed to sticky pin style and text colour passed into renderCellValue. Match parsed projected values, not raw strings.

## Client: visual grouping, never lazy fetching on toggle
- **Rule:** Both initially collapsed and expanded pages always request `grouped:true, withRowGroups:true` for the normal filtered/paginated row query. Expansion/default/exception state is NEVER a query dependency and never sets page=1.
- **Why:** User explicitly rejected per-group lazy loading and cosmetic spinners. Grouping is a visual organization feature; any group's opening/closing must be immediate without a server request.
- **How:** Keep a default-open boolean plus a Set of per-group exceptions; each header inverts only its own key. Multiple groups can independently open from collapsed mode. Expand-all clears exceptions and sets default open; collapse-all clears exceptions and sets default closed. No header spinner/loading row and no group-specific total snapshot.
- Page metadata `groupDefaultExpanded` seeds local state initially and on entity/page/group-field/default changes. False starts all closed, true all open; subsequent toggles do not update server metadata.
- `groupingActive = Boolean(groupByFieldKey) && !setupMode`; setup remains flat. Add-row stays hidden in grouped mode.
- **Pagination:** Preserve ordinary page size and server paging across all groups. Render only headers belonging to the current page's records, interleaved with their correctly mapped rows. Header counts/sums remain full-filtered-group aggregates. A group can span pages. Pager remains visible even when all page groups are closed, so later pages are reachable; do not silently preload/cap the complete dataset.
- Membership and row snapshot publish atomically with the existing query/projection generation. Stamp readiness with queryKey, not expansion state. Filters, page changes, permissions and route/group-field scope changes still clear old rows/groups/totals before paint. Same-query refresh keeps the table mounted. Flat fallback ignores expansion.
- `groupByKey` remains a plain Map built in the render section, not a new hook after early returns.
- Collapsed records do not mount row components or do row-formatting work. Local toggles leave server numericTotals untouched, so the strip remains visible and the table does not jump.
- **Aggregate writes:** Any write affecting group common values/sums must refresh the main records query as well as cell projections. Updating only page record-values leaves headers stale. Normal server/SSE refresh and error/retry mechanisms remain; local grouping does not replace freshness.