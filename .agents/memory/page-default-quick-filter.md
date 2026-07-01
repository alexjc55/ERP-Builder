---
name: Page default quick-filter & filter-values baseFilters
description: How the records filter-values endpoint separates a view's HARD filters from ad-hoc picks, and how the per-page SOFT default quick-filter seeds the bar without ever bypassing the hard boundary.
---

## filter-values: baseFilters vs filters (the dependent-dropdown fix)

The records `filter-values` endpoint (option lists for the filter bar) takes TWO
condition arrays that both compose under one conjunction into the same query:

- `baseFilters` — the view's / entity-default HARD filters. Kept on EVERY field,
  including the target field being listed. So a field the view pins to a fixed
  value only offers the permitted value(s) — never all values.
- `filters` — the viewer's AD-HOC picks. These self-exclude the target field
  (`c.field !== target`) so a field's own current selection can still be widened.

**Why:** before the split, the client merged view filters into `filters`, which
self-excluded the target field wholesale, so a view-pinned field's dropdown
listed ALL values (leaking values the view hides from view).

**How to apply:** never merge a view's fixed filters into the self-excluding
`filters` array. Persistent/hard filters always go in `baseFilters`. The endpoint
still re-applies the full records read boundary (field visibility, own-row scope,
hidden-status, archived) independently — baseFilters is a query narrowing, not the
security boundary.

## Per-page SOFT default quick-filter

`pages.defaultQuickFilterJson = { fieldFilters?: Record<string,string[]>; statusIds?: number[] }`
pre-fills the filter bar on page open. It is USER-ADJUSTABLE and can NEVER reveal
rows the view's hard filter hides — it only seeds the ad-hoc field-dropdown +
status quick-filter, which AND on top of `baseFilters` in the records query.

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
- Persistence: `defaultQuickFilterJson` is in the pages PUT update allowlist and
  in the create insert (create uses `parsed.data` wholesale).

## Per-page SOFT EXCLUSION default + "show hidden"

`defaultQuickFilterJson` also carries `excludeFieldFilters?: Record<key,string[]>`
and `excludeStatusIds?: number[]` — a SOFT "show all EXCEPT …" default that hides
matching rows until the viewer flips a "Показать скрытые" checkbox.

- **Exclusion is a SEPARATE query concept from inclusion filters.** In
  `buildRecordQuery` the exclusion chunks are appended as their own top-level AND
  terms — NEVER routed through the view's `filterConjunction`. **Why:** a view with
  OR logic must not be able to turn an exclusion into a widening. It only ever
  NARROWS, so it can never reveal rows the view's hard filter hides.
- **Must be NULL-safe** (excluding value B hides only rows that ARE B; empty/null
  rows are kept): scalar → `(expr IS NULL OR expr NOT IN (...))`; relation →
  `NOT relationValueExists(... IN ...)` (the NOT EXISTS keeps unlinked rows);
  status → `(statusId IS NULL OR statusId NOT IN (...))`.
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
  Drafts sync from the stored default on seed; one Save writes the whole
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
