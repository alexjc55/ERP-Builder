---
name: Record Views & query endpoint
description: POST query consumption plus page-scoped, server-authoritative named views and their hard-filter boundary.
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

## View bootstrap must reset on entity AND page context
A component that auto-selects a default/first view can remain mounted while moving between the main page and a mirror of the same entity. Reset view bootstrap/state on `(entityId,pageId)`, not entity alone, or a view from one page leaks into another scope.

## Named views are page-scoped and server-authoritative
Each named view belongs to exactly one runtime scope: `targetPageId = null` for the entity's main page, or one concrete mirror page. A page-scoped view may use that page's local fields; a main view may not.

**Why:** page-local values only have meaning at one `(pageId,recordId)`, and browser-supplied copies of view filters were removable/tamperable.

**How to apply:**
- Runtime lists only exact-scope active/role-visible views. A mirror page with visible assigned views requires a valid `viewId`; no implicit “all records” bypass exists.
- The server validates selected view entity, exact target page, active state, role visibility, and explicit page access before computing any rows, pivot, totals, or filter values.
- Stored view filters and saved search are authoritative. Filter conditions keep their internal `AND/OR`, but the whole hard group is top-level `AND` with viewer filters, page defaults, archive/status/row scope, and RBAC.
- Clients send `viewId`, not copied named-view filters. User-adjustable filters/search remain unchanged when switching views.
- `is_empty`/`is_not_empty` use actual missing/JSON-null/empty-string semantics for entity and page-local values; never encode emptiness as display text.
- Defaults are unique per scope: one main default and one per concrete mirror page. One page view auto-selects; several select default-or-first and show only that page's view choices.

## Schema naming
FilterCondition/SortSpec use `field` + `operator`/`direction` (NOT `fieldKey`). Field keys in filters/sorts are whitelist-validated server-side against the entity's active fields (400 on unknown); values are Drizzle bound params. configJson holds `{filters, filterConjunction, sorts, search, visibleFields}`.

## Entity-level default sort + filters (no view selected)
Row ordering AND base filters when NO view is selected (the implicit "По умолчанию") come from `entities.defaultSortJson` (`SortSpec[]`) and `entities.defaultFilterJson` (`FilterCondition[]`), configured in the same views-admin card/dialog (persisted together with the entity PUT, gated by `requireAdmin("entities")`). A selected view's sort config takes priority; its hard filters/search are loaded by the server from `viewId`. Entity-default filters combine with implicit AND (no stored conjunction). Empty sort → server fallback `created_at DESC`.
**Why:** users needed default sorting/filtering without the ceremony of creating a named view; the implicit default previously had no settings at all.
**How to apply:** client computes `baseFilters = selectedView ? [] : entityDefaultFilters`; the selected named view is carried only as `viewId`. Effective sorts still come from the selected view or entity default. Always filter entity defaults against current active field keys before sending.

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
