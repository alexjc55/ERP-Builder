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
