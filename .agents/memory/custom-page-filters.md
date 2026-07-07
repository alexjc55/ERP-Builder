---
name: Custom page filters (multi-field date)
description: Reusable per-page named filters combining several entity date fields under one filter-bar chip; the invariants that must stay consistent.
---

# Custom page filters (multi-field date)

Admins define reusable, named per-page "custom filters" that combine several
entity **date/datetime** fields under ONE filter-bar chip. Stored as
`customFiltersJson` (jsonb) on the `pages` row, shape `customPageFilterSchema`
(`{ id, labelJson, type:"date", fieldKeys[], combine:"or"|"and"|"overlap" }`).
Motivating case: "Работы за период" over two date fields → rows where EITHER
date falls in the picked period (OR). v1 = date type + entity fields only
(no page-local, no pivot; pivot/calendar queries intentionally do NOT carry
`customFilters`). Gated by the existing `pages` cap.

## Server invariants
- The def list is **authoritative from the DB** (`pages.customFiltersJson`),
  never from the client. The request only sends `customFilters` = picks
  (`{ id, range }`); the server matches by `id`.
- Per-def, re-apply the records field boundary: keep only **visible +
  isFilterable + date/datetime** fieldKeys. Field order is preserved because
  `overlap` uses first key = start, last key = end.
- `buildCustomDateFilter` uses **half-open `[from, to)`** (`>= from AND < to`).
  For `and`/`overlap` a NULL bound excludes the row (SQL 3VL — condition never
  becomes TRUE). Requires `pageId` (400 otherwise).

## Client invariant (the bug that bit us)
**Why:** the records query dep-key must derive from the ACTUAL picks
(`JSON.stringify(customFilterPicks)`), NOT from raw `customDateFilters` state.
Picks are gated by the current page's defs; if the key came from raw state,
changing the page's `customFiltersJson` (setup-mode save + invalidate) without
touching the picked dates would leave the query cached with stale/removed ids
→ 400 "Unknown custom filter" or new defs not applying.
**How to apply:** any per-page filter channel whose payload is gated by
server-authoritative defs must key the query on the gated payload, not the raw
picker state.

## Cross-page safety
Def ids are UUIDs (unique per def), and client picks are filtered to the
current page's known def ids, so switching between two pages of the same entity
cannot leak a stale pick into the query even though EntityRecords is not keyed
by pageId (state reset only fires on entityId change).
