---
name: Custom filters (per-entity, automations-style)
description: Per-entity admin-authored custom filters (two-level И/ИЛИ tree over ANY field incl. formula, with runtime inputs); the apply-engine invariants that must stay consistent.
---

# Custom filters (per-entity, automations-style)

Кастомные фильтры are per-ENTITY, structured EXACTLY like entity Automations: a
row per filter in the `custom_filters` table, edited at
`/admin/entities/:entityId/custom-filters`, gated by the RBAC cap
`customFilters`. Each filter renders as ONE chip on the records filter bar and
narrows the entity's TABLE, PIVOT (сводная) and CALENDAR views.

A filter is a two-level boolean tree: GROUPS combined by a top-level
conjunction (И/ИЛИ), each group combining its own CONDITIONS — enough for
`(A И B) ИЛИ (C И D)`. A condition targets ANY field (entity OR page-local via
`pageId`), ANY type INCLUDING formula, **ignoring `isFilterable`**. Operators:
eq/neq/contains/notContains/gt/lt/gte/lte/between/empty/notEmpty. A condition's
value is fixed (`value`) or user-supplied at apply time (`valueSource:"input"` +
`inputId`); the filter declares its inputs in `inputsJson`, and several
conditions can share one input (flagship «Работы за период»: one period feeds
two date fields).

## The retirement that must not regress
The OLD design (`pages.customFiltersJson` — per-page multi-date chip) is GONE.
Do not re-add a `customFilters` prop on pages or reference `pages.customFiltersJson`.
The client channel is now `CustomFilterPick[]` (`{ id, inputs?: [{inputId,value}] }`)
carried on the records/query, pivot and calendar-base POST bodies.

## Apply-engine invariants (`custom-filter-apply.ts`)
- **Admin-authoritative but never widening.** The compiled predicate is only
  ever AND-ed into the caller's existing WHERE (viewer row-scope / hidden fields
  / status / archive). It can reference fields hidden for the viewer, but the
  returned rows still obey the viewer boundary — a custom filter only NARROWS.
- **Defs come from the DB by id**, never the client. The client sends picks; the
  server loads `custom_filters` rows and matches by id (unknown id → 400).
- **Two evaluation strategies.** SQL path (default) compiles the whole tree to
  ONE nested predicate. JS path is used **only when any condition (entity OR
  page-local) references a formula field** — a formula value is never stored, so
  the tree is evaluated in JS over every entity record → `id IN (...)`. Empty
  set must become `sql\`false\`` so an empty match excludes everything (not
  "no-op").
- **Page-local formula must be computed in the JS path.** For `fieldSource:"page"`
  do NOT blindly read the stored value + treat as text: look up the page field
  meta, and if it is a `function` field, build a page-local `buildFormulaScope`
  from the page values and compute it; otherwise pick the comparison kind
  (numeric/date/text) from the page field's type. (The first cut hard-coded
  page → text and silently never matched page-local formulas.)
- **Runtime input usability is a deterministic gate, not a SQL cast.** Before
  building anything, an input value that is unfilled / partial (one side of a
  range) / malformed for its declared `inputsJson` type deactivates the WHOLE
  filter (`inputMissing` → skip), so a bad date/number never reaches a
  `::timestamptz`/numeric cast and 500s.
- Requires `pageId` in context whenever a condition targets a page-local field
  (400 otherwise).
- **LIST read is gated by ENTITY-LEVEL record `view`, NOT auth-only.** The chip
  bar must render for everyone who can view the entity's records, but never for an
  authenticated user with no access to that entity — use
  `requireRecordParam("view", { entityOnly: true })` (superAdmin bypasses), not a
  bare `requireAuth`. A bare auth gate lets any logged-in user enumerate filter
  defs (condition trees + static values, incl. hidden-field references) for
  arbitrary entity ids. Only CREATE/UPDATE/DELETE/REORDER stay behind the
  `customFilters` cap; the single-filter GET stays cap-gated (admin editor only).
