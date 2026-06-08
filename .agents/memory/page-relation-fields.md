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

## Count metric must NOT resolve a related field
**Rule:** for a related metric, `count` sends `fieldKey: null` by design (it counts links, no field needed). The compute path must resolve only the relation *direction* (via `relationDirection`) for count; calling `resolveRelationField(..., fieldKey ?? "")` errors (field "" not found) → silently returns 0. Only `sum` resolves the related field. Validation already allows count-without-field; the bug was compute-side.

## Per-page role visibility is a SERVER boundary, not a client filter
**Rule:** `GET /pages/:pageId/fields` must drop page-fields whose `permissionsJson[roleId] === "hidden"` for non-admin viewers — the column metadata/label/config must never reach a hidden role, not just its values. Admins who can edit pages (superAdmin || admin.pages) still receive every field so column setup mode can configure hidden columns.

**Why:** the frontend derives displayed columns straight from this endpoint; filtering only on the client leaks restricted column existence/labels/config. The related-values endpoint already filters values by role, but metadata must be gated at its own source.

## relation-options for widget editors is gated by `pages`, not `entities`
**Rule:** the entity-keyed `GET /entities/:entityId/relation-options` backs the dashboard widget editors (metric related fields, table related columns), so it must be gated by the SAME cap as widget editing (`requireAdmin("pages")`), not `requireAdmin("entities")`. The page-keyed variant is also `pages`.

**Why:** a role that can build dashboards but lacks the entities-builder cap was locked out of configuring related metrics/columns — a capability regression. Gate config-helper endpoints by the cap of the screen that consumes them.

## Table widget needs ≥1 column across direct OR related
`validateTableConfig` must accept a config where `fieldKeys` is empty as long as `relatedColumns` has at least one entry (related-only tables are valid). Requiring non-empty `fieldKeys` breaks the related-only UX the frontend allows.

## `relation` is a PAGE-FIELD-only type sharing the entity FieldType enum
The `relation` value lives in the shared `FieldType` OpenAPI enum (used by BOTH entity-field and page-field create/update bodies), but it is only valid for page-fields (it needs relationConfigJson). Entity-field create/update must reject `fieldType === "relation"` server-side, and the entity-field type picker must not offer it. **Why:** shared contract enums leak new values to every consumer; constrain invalid ones at each server boundary.

## Widgets are admin-authoritative but visibility-gated
Metric/chart/table widget values are computed bypassing the viewer's row/field perms (real totals), but only after page access + per-widget role visibility pass. Related columns/metrics inherit this — do not re-filter widget values by viewer perms.

## related-values must re-apply the related entity's RECORD-VIEW boundary first
**Rule:** before exposing any related column metadata/value, check `canRecord(perms, relatedEntityId, "view")`. If the viewer cannot view the related entity at all, force `access = "hidden"` (no type, no value, no linkedRecordId).

**Why:** `resolveFieldAccess` defaults to `"view"` when no explicit field perm exists, so relying on it alone leaks values from an entity the viewer has zero record-view permission on. Field/own-scope checks are NOT a substitute for the entity-level view gate.

**How to apply:** this gate is only for VIEWER-scoped reads (the records-table related-values endpoint). Dashboard widget compute paths are admin-authoritative by design (bypass viewer perms, gated by per-widget role visibility) and must NOT add this check.

## related-values endpoint must not leak restricted linked-record ids
`POST /pages/:pageId/related-values` re-applies the related-entity field access + related own-scope + per-page role visibility. **Only expose `linkedRecordId` when the linked row is actually visible** to the viewer. Returning the id while nulling `value` leaks existence/identity of restricted related rows (IDOR-adjacent). The id is only needed for cells the viewer can read (and, when editable, write back through), so gate it on the same `visible` flag as `value`.
