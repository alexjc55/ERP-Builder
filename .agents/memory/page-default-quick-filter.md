---
name: Page default quick-filter & authoritative filter-values
description: How filter-values separates authoritative named views, no-view entity defaults, and per-page soft filters without bypassing the hard boundary.
---

## filter-values: authoritative viewId vs entity-default baseFilters

The records `filter-values` endpoint separates three sources:

- `viewId` — a named view's server-loaded authoritative hard filters/search.
  They stay applied to every target, so a pinned field never offers values outside
  the view.
- `baseFilters` — only the entity-default filters when no named view is selected.
- `filters` — the viewer's AD-HOC picks. These self-exclude the target field
  (`c.field !== target`) so a field's own current selection can still be widened.

**Why:** browser-supplied named-view filters were removable, and merging them into
`filters` self-excluded the target field, exposing values outside the view.

**How to apply:** never send a named view's fixed filters in caller arrays; send
`viewId`. Only no-view entity defaults use `baseFilters`. The endpoint re-applies
exact page access plus field/row/status/archive boundaries independently.

## Per-page SOFT default quick-filter

`pages.defaultQuickFilterJson = { fieldFilters?: Record<string,string[]>; statusIds?: number[] }`
pre-fills the filter bar on page open. It is USER-ADJUSTABLE and can NEVER reveal
rows the view's hard filter hides — it only seeds the ad-hoc field-dropdown +
status quick-filter, which AND on top of the authoritative view group.

- **Seeding effect is authoritative** for the two dimensions it owns
  (`fieldFilters`, `statusFilter`): on each (entityId, pageId) it sets them to the
  page's default OR clears them when the page has none. **Why:** the general
  filter-reset effect is keyed on `[entityId]` only, so a same-entity page switch
  (a normal page ⇆ its mirror onto the same entity) would otherwise leave the
  prior page's picks in place. Storage is per-page, so main and mirror keep
  independent defaults.
- Seed runs once per (entityId, pageId) via a `quickFilterSeeded` flag reset on
  `[entityId, pageId]`. After saving from setup mode the pages query is
  invalidated (prop identity changes) but the flag stays set, so the admin's
  current selection is not clobbered.
- **Authoring is gated to setup mode AND `canAdmin("pages")`** (no new RBAC cap) —
  the save/clear control lives in the setup panel; it reuses the existing filter
  pickers (admin sets filters in normal mode, then saves from setup mode). The
  filter bar is hidden in setup mode, so the panel shows a readable summary of
  what will be saved.
- **The setup panel is COLLAPSED by default** (it's irrelevant on most pages) and
  re-collapses on every `[entityId, pageId]` switch; the title row is a toggle with
  a chevron + a green dot when the page already has a stored default or exclusion.
- Persistence: `defaultQuickFilterJson` is in the pages PUT update allowlist and
  in the create insert (create uses `parsed.data` wholesale).

## Per-page SOFT EXCLUSION default + "show hidden"

`defaultQuickFilterJson` also carries `excludeFieldFilters?: Record<key,string[]>`,
`excludeEmptyFieldKeys?: string[]`, and `excludeStatusIds?: number[]` — a SOFT
"show all EXCEPT …" default that hides matching rows until the viewer flips a
"Показать скрытые" checkbox.

- **Exclusion is a SEPARATE query concept from inclusion filters.** In
  `buildRecordQuery` the exclusion chunks are appended as their own top-level AND
  terms — NEVER routed through the view's `filterConjunction`. **Why:** a view with
  OR logic must not be able to turn an exclusion into a widening. It only ever
  NARROWS, so it can never reveal rows the view's hard filter hides.
- **Selected-value exclusions stay NULL-safe** (excluding value B hides only rows
  that ARE B; empty/null rows are kept): scalar → `(expr IS NULL OR expr NOT IN (...))`; relation →
  `NOT relationValueExists(... IN ...)` (the NOT EXISTS keeps unlinked rows);
  status → `(statusId IS NULL OR statusId NOT IN (...))`. An explicit
  `excludeEmpty` condition instead requires `NULLIF(BTRIM(expr), '') IS NOT NULL`,
  so NULL, empty, and whitespace-only values are hidden without a magic sentinel.
- **filter-values skips the TARGET field's own exclusion** (`ex.field !== target`)
  so its dropdown still lists every selectable value, but applies all OTHER
  exclusions so co-occurring option lists stay consistent with the visible rows.
- **Client gates sending exclusions on `hasExclusion && !showHidden && !setupMode`.**
  `showHidden` resets on `[entityId, pageId]` (per-page clean slate); setup mode
  always shows everything so admins can review. The bar's "show hidden" toggle is
  visible to ALL viewers whenever the page has an exclusion.
- **Authoring UI** (setup mode, `canAdmin("pages")`): exclusion values come from
  the field's CONFIGURED select `optionsJson` + the FULL status list — authored,
  not sampled from existing rows (so you can pre-exclude a value with no rows yet).
  Each selectable entity/page field also has a regular **"Пусто"** chip beside
  its configured values; it stores the separate empty-exclusion key internally,
  never a fake select option. Drafts sync from the stored default on seed; one Save writes the whole
  `defaultQuickFilterJson` (inclusion from the bar + exclusion drafts).
- **Exclusion is SOFT/cosmetic, never a security boundary.** The real boundary
  (view hard filter, own-row scope, hidden-row statuses, hidden fields) is enforced
  independently, so "show hidden" can only reveal rows the viewer was already
  allowed to see.
- **v1 scope: exclusion applies to the TABLE (records/query) only.** Pivot
  (`/records/pivot`) and calendar deliberately do NOT receive exclusions —
  inclusion seeds (fieldFilters/statusFilter) still flow to pivot via the live bar,
  but exclusions do not. Safe because pivot is an aggregate already permission-
  scoped to the viewer and exclusion is cosmetic. Revisit if uniform behavior is
  wanted: would need `excludeFilters`/`excludeStatusIds` added to the pivot schema
  + spec construction (they share `computePivot`/`buildRecordQuery` core).


## Page-local fields in the SOFT default + exclusions (added 2026-08)

`defaultQuickFilterJson` also carries `pageFieldFilters` and
`excludePageFieldFilters` (Record<fieldKey,string[]>) and
`excludeEmptyPageFieldKeys` for PAGE-LOCAL fields.
Inclusions ride the existing `pageLocalFilters` query channel; exclusions ride a
dedicated `RecordQuery.excludePageLocalFilters` (selected values use NULL-safe
`expr IS NULL OR NOT IN`; empty exclusion requires a nonblank scalar; always AND
— never widens). Exclusions stay table-only
(pivot/calendar excluded, same v1 rule as entity exclusions) and are validated
server-side against ACTIVE value-backed page fields plus the viewer's field-
visibility boundary (no `isFilterable` gate — authoring is independent of the live
filter bar). Stale/deactivated/retyped/hidden soft exclusions are ignored rather
than breaking the whole page or exposing protected values through row counts.

**Client rule:** every outgoing page-local inclusion condition must be pruned
against the current `filterablePageFields` set (deleted/deactivated/hidden/type-
changed fields) — the server hard-400s unknown or non-filterable page-local
filter keys, which would break the whole table.
