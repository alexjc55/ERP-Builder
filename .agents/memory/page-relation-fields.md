---
name: Page related fields (related columns / related metrics)
description: Surfacing a single linked record's field on pages, in dashboard metrics, and in table widgets — the aggregation and boundary rules that must stay consistent.
---

# Page related fields

Page-fields of type `relation` (config `{relationId, relatedFieldKey}` in `relationConfigJson`) surface ONE field of a single linked record. Only single-link directions qualify: source side ∈ {one_to_one, many_to_one}, target side ∈ {one_to_one, one_to_many} — i.e. each base record links to at most one related record.

## Related metric aggregation is PER LINK, not per unique linked record
**Rule:** a related metric is computed over the filtered BASE records. For each base record that has a link, walk to its single linked record. `count` = number of links (`map.size`, base→linked map). `sum` = the related numeric field summed once per *linking base record*.

**Why:** under many_to_one / one_to_many several base records can point to the SAME linked record. Deduping linked ids (`new Set(map.values())`) undercounts and under-sums — a real correctness bug caught in review. The metric question is "over my filtered base rows, count/sum their linked value", so each link must contribute even when it points at a shared related record.

**How to apply:** in `dashboard.ts` `computeMetric` related branch, fetch the related field value into a `Map<linkedId, value>` over the *unique* linked ids (one query), then accumulate by iterating `map.values()` (the per-base-record linked ids, with duplicates). Never return `Set(map.values()).length`.

## Widgets are admin-authoritative but visibility-gated
Metric/chart/table widget values are computed bypassing the viewer's row/field perms (real totals), but only after page access + per-widget role visibility pass. Related columns/metrics inherit this — do not re-filter widget values by viewer perms.

## related-values endpoint must not leak restricted linked-record ids
`POST /pages/:pageId/related-values` re-applies the related-entity field access + related own-scope + per-page role visibility. **Only expose `linkedRecordId` when the linked row is actually visible** to the viewer. Returning the id while nulling `value` leaks existence/identity of restricted related rows (IDOR-adjacent). The id is only needed for cells the viewer can read (and, when editable, write back through), so gate it on the same `visible` flag as `value`.
