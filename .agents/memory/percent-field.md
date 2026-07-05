---
name: Percent field type
description: How the "percent" (Проценты) field type stores, validates, and aggregates — and the invariants that must stay consistent.
---

# Percent field type (Проценты)

A numeric field type with two modes via `percentConfigJson` ({ mode?: "list"|"value"|null; decimals?: number|null }), present on BOTH entity fields and page-local fields.

- **Storage:** value is stored as a NUMBER (30 = 30%), never a string — so it participates in formulas and averages. Mode defaults to `"value"` when unset (`percentConfigJson?.mode ?? "value"`).
- **list mode:** the value must be one of the numeric preset options. Options use the shared numeric-options contract (option.value = a numeric string like `"12.5"`, labelJson `{ru:"12.5%",…}`) via `PercentOptionsEditor` — do NOT reuse `SelectOptionsEditor`, which derives values from labels and would corrupt the numeric contract.

## Aggregation: AVERAGE, not sum — the key divergence
Percent columns aggregate as an **arithmetic mean over records that HAVE a value** (empties ignored). Unlike number/formula totals, this is shown **ALWAYS** — it is NOT gated by `showColumnTotal`. This holds at every aggregation surface: entity flat totals, page-local flat totals, group buckets (entity + page-local), and mirror-group buckets. When adding a new aggregation surface, remember percent is average+always-on, everything else is sum+opt-in.

## Two boundary invariants that were missed once and must stay fixed
1. **list-mode validation compares by NUMERIC equivalence, not string.** Use `optionNumbers(optionsJson)` (a `Set<number>`), NOT `optionValues(...).has(String(num))`. The config regex accepts `"12.50"`/`"001"`, which `String(Number(...))` canonicalizes to `"12.5"`/`"1"` → false rejections. Applies to both entity records (`records.ts`) and page-local values (`page-fields.ts`).
2. **page-local percent must be included in the FLAT totals row**, not only in grouped buckets. The flat page-local totals query is scoped to `showColumnTotal=true`; percent is always-on, so the query must also pull `fieldType="percent"` rows (via `or(...)`) and average them separately (key `pf:<id>`), independent of `showColumnTotal`.

**Why:** these two are easy to miss because percent piggybacks on the select-options and number-totals machinery, but its contract diverges (numeric options, average-always). Both were regressions caught in code review.

## i18n
`fields.type.percent` is a TEMPLATE key (`fields.type.${ft.value}`) → invisible to the seed regex, so it (and the percentMode/percentDecimals/percentOptions* keys) MUST be curated in `scripts/src/data/ui-translations.json`. See `erp-i18n.md`.
