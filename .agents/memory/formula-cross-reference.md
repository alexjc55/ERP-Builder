---
name: Formula cross-references
description: How a formula (function) field can reference another formula field's computed result, and the invariants that keep it correct everywhere.
---

# Formula fields referencing other formula fields

A `function`-type field's value is **never stored** — it is computed at read time from a values map. So a formula that references another formula (`{other_formula}`) used to resolve to `null`, because the map only held stored (`valuesJson` / page-value) keys.

## The mechanism: `buildFormulaScope` (lib/formula)
`buildFormulaScope(base, formulaDefs)` returns a **Proxy** over `base`:
- a key present in `base` (any stored field) → returns the stored value;
- a key that is a formula field and NOT in `base` → evaluated lazily via `evaluateFormula` on first access, then **memoized**;
- self/circular references resolve to `null` (an `inProgress` set is the cycle guard) so a bad config can never infinitely recurse;
- the cached formula value is the **RAW (unrounded)** result → chained formulas keep full precision; each display/total site still rounds to its own `decimals` (spreadsheet-style: compute on full precision, round only at the leaf).
- returns `base` unchanged when there are zero formula defs (no overhead / no Proxy).

`FormulaFieldDef = { key, expression, decimals? }`.

## Invariants (must stay consistent)
- **Wire it at EVERY formula-eval site**, or a surface silently reverts to null-refs. Sites: client `EntityRecords.tsx` (per-row render + conditional-formatting lookups), server `records.ts` POST `/records/query` — entity flat totals, page-local flat totals, and the grouped (group-by) pass for entity formula sums, page formula sums, and the entity/page formula "common value" pass.
- **The scope's formula-def list must contain ALL formula fields in that context, NOT a filtered subset.** Two real footguns caught here:
  - build entity defs from ALL active fields (incl. hidden) — matches the existing "totals compute over the true raw values" decision, and lets a formula reference a hidden formula.
  - build **page** defs from ALL active page function fields for the page — do NOT reuse the `showColumnTotal`-filtered `pageFieldRows`, or a total-enabled formula that references a non-total page formula resolves it to null. (The group pass's `gPfRows` already loads all active page fields, so it's fine.)
- **Never spread the Proxy** (`{...scope}`) — `ownKeys` isn't trapped, so virtual formula keys are dropped. Pass the scope straight into `evaluateFormula` / index it directly.

## Deliberately out of scope (v1)
- `pivot-compute.ts` formula **measures**: admin-authored expressions restricted by an `allowedKeys` whitelist (a different security model) — left untouched.
- `DashboardView` widget formulas: operate over a metrics map, not entity field values — cross-field-formula doesn't apply.
