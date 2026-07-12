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

## Calendar view type is a client-side render of the same filtered rows (viewer-scoped)
A `viewType: "calendar"` view (config `CalendarConfig { dateFieldKey, endDateFieldKey?, titleFieldKey?, cardFieldKeys[], colorBy?, colorFieldKey?, defaultMode? }`) is just another render of `records/query` — **no new endpoint, no admin-authoritative path** (unlike pivot/dashboard). It MUST stay viewer-scoped: it reuses the viewer's field/row/entity read boundary by going through `records/query` and rendering the RBAC-visible field set.
**Why:** a calendar is a presentation of the user's own filtered data; it has no reason to bypass perms the way pivot/dashboard totals do.
**How to apply:**
- Pass the **RBAC-visible** field set (`visibleFormFields`), NOT the table-column set (`displayFields`), so configured `cardFieldKeys`/`titleFieldKey` always resolve while hidden fields stay hidden.
- Date-window narrowing: a window filter can only be appended server-side when `filterConjunction` is AND (or no base filters). The endpoint applies ONE conjunction to the whole filter list, so under OR an appended window would OR-WIDEN. Under OR, send NO window filter and instead page by `dateFieldKey` ASC, stopping once a row starts ≥ windowEnd (asc order ⇒ all later rows are also out). Always re-filter the window client-side for exactness (spans, OR).
- Capped pagination (MAX_PAGES) must surface a **truncation banner** when the cap is hit with rows still unread — never silently drop events.

## Per-view column visibility — narrows, NEVER expands
A table view's `configJson.visibleFields` (entity field keys) can NARROW which
columns the records table shows. It is applied as an INTERSECTION with the
already-permitted set: `tableFields` → `showInTable !== false` → (if a non-pivot/
non-calendar view is selected with a non-empty `visibleFields`) keep only keys in
`visibleFields`. Column ORDER still follows field `sortOrder` (per-view ordering is
intentionally out of scope). Empty/absent `visibleFields`, no view, pivot/calendar
view, or setup mode = no narrowing (all default columns).
**Why (the footgun that got this disabled once):** previously seeded default views
had `visibleFields` populated but the views UI had NO column picker, so selecting a
view silently hid columns with no way to fix it. Two rules prevent a repeat:
(1) there is now an explicit chip-toggle picker in the table-view editor with a
"Показать все" reset, and (2) empty list = no override (never written to config).
**Security invariant (must stay true):** a view may only narrow within the
permission-scoped `tableFields` (which already applied field role perms +
`showInTable`); it must NEVER reveal a hidden/no-perm field. Keep it as a `.filter`
over `tableFields` (intersection) — never a union/lookup that could resurrect a
field. Any new render path (cells, totals, conditional formatting, export) must
read from the already-narrowed `displayFields`/`orderedColumns`, not re-derive
columns from raw fields. Page-local (mirror) columns are NOT part of `visibleFields`
(picker lists entity fields only) and are unaffected.

## Rows per page (pageSize)
- Rows-per-page (50/100/200) is a VIEW-level setting, not per-user: named views carry `configJson.pageSize` (table views only; absent = inherit), the default (no view) table uses `entities.default_page_size` (null = 50). Client precedence: view → entity default → 50, values validated against [50,100,200] on both sides.
- A localStorage/footer per-user selector was built and then removed per user request — do NOT reintroduce per-user page size. When the effective pageSize changes, page resets to 1.
