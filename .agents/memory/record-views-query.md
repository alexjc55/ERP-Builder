---
name: Record Views & query endpoint
description: Why the records query endpoint is POST, how the frontend consumes it, and the per-entity bootstrap-reset rule.
---

# Record Views (Этап 8) — durable decisions

## Query endpoint is POST, and Orval makes it a mutation
`POST /entities/{id}/records/query` takes a rich JSON filter tree in the body.
**Why POST, not GET with query params:** rich nested filter/sort trees don't fit cleanly in query strings, and Orval generated a `TS2308` path+query collision when we tried a GET with both. Keep it POST.

**Consequence:** Orval generates `useQueryEntityRecords` as a **mutation** (`useMutation`), not a query — it has no caching/invalidation. To use it reactively in a component:
- Drive it from a `useEffect` that calls `mutateAsync({ entityId, data: recordQuery })` and stores `{data,total}` in local `useState`.
- Re-run on a `JSON.stringify(recordQuery)` key + an `entityId` dep.
- After create/edit/delete CRUD, bump a `refreshTick` state (add it to the effect deps) instead of `queryClient.invalidateQueries` — the display no longer reads the list-query cache.
- Guard against races with a `cancelled` flag in the effect cleanup.

## Per-entity bootstrap must reset on entityId change
A component that does one-time bootstrap (e.g. auto-selecting the entity's default view via a `viewInitialized` flag) and is keyed by a prop that can change **in place** (entityId) MUST reset that flag + dependent state (`selectedViewId`, `search`, `page`) in a `useEffect([entityId])`. Otherwise stale state leaks across entity switches when the component doesn't remount. (Architect-caught bug.)

## Schema naming
FilterCondition/SortSpec use `field` + `operator`/`direction` (NOT `fieldKey`). Field keys in filters/sorts are whitelist-validated server-side against the entity's active fields (400 on unknown); values are Drizzle bound params. configJson holds `{filters, filterConjunction, sorts, search, visibleFields}`.

## Entity-level default sort + filters (no view selected)
Row ordering AND base filters when NO view is selected (the implicit "По умолчанию") come from `entities.defaultSortJson` (`SortSpec[]`) and `entities.defaultFilterJson` (`FilterCondition[]`), configured in the same views-admin card/dialog (persisted together with the entity PUT, gated by `requireAdmin("entities")`). A selected view's own `configJson.sorts`/`filters` always take priority; default filters combine with implicit AND (no stored conjunction). Empty sort → server fallback `created_at DESC`.
**Why:** users needed default sorting/filtering without the ceremony of creating a named view; the implicit default previously had no settings at all.
**How to apply:** client computes `baseFilters = selectedView ? viewFilters : entityDefaultFilters` and `effectiveSorts` the same way, applied uniformly to the records query, pivot query, and dependent-filter options query (key off `baseFiltersKey`). Always filter both defaults against the entity's *current* active field keys before sending — a field deleted after the default was set would otherwise trip the server whitelist and break the default table for everyone.

## Filter VALUE editor must be type-aware AND store server-comparable text
The view/default filter value editor branches by field type: `select`→option picker, `user`→user picker (RBAC-filtered by `userConfigJson.allowedRoleIds`, matching the user's FULL role set) that stores the **user id as text**, `boolean`→yes/no storing `"true"`/`"false"`, `date`/`datetime`→native pickers, else text. Array operators ("one of") serialize as comma text → array.
**Why:** `record-query.ts buildCondition` compares `values_json ->> key` lexically for non-numeric/date types, so the stored filter value MUST match how the record value is stored (user values are ids as text; booleans are `"true"/"false"`). A free-text box let users type values that never matched.
**How to apply:** keep the editor and `buildCondition` in lockstep — any new field-type filter must store text the server comparison understands. Reuse the shared `FilterRowsEditor` so the view dialog and the default-view dialog stay identical; changing a row's field clears its value (editors are type-specific).

## Views do NOT control which columns show — per-field "Показывать в таблице" does
A view's `configJson.visibleFields` is **no longer used to choose/limit the records-table columns**. Columns are governed solely by each field's per-page `showInTable` flag (plus field-level role perms via `tableFields`); column order follows field `sortOrder`. A view carries only sort/filter/search.
**Why:** the views admin UI never exposed a column picker, yet seeded default views had `visibleFields` populated — so selecting the default view silently hid columns the field settings said to show, with no way for the user to fix it. The user's model: column visibility is a per-page/per-field decision (independently per page, even for related/mirror columns), not a view concern.
**How to apply:** if per-view column sets are ever wanted again, add an explicit column picker to the views UI AND re-introduce the `visibleFields` branch in `EntityRecords` `displayFields` — don't silently resurrect the old behavior. `visibleFields` stays in the ViewConfig type for backward compat but is display-inert.
