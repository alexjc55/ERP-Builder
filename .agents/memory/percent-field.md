---
name: Percent field type
description: How the "percent" (Проценты) field type stores, validates, and aggregates — and the invariants that must stay consistent.
---

# Percent field type (Проценты)

A numeric field type with two modes via `percentConfigJson` ({ mode?: "list"|"value"|null; decimals?: number|null }), present on BOTH entity fields and page-local fields.

- **Storage:** value is stored as a NUMBER (30 = 30%), never a string — so it participates in formulas and averages. Mode defaults to `"value"` when unset (`percentConfigJson?.mode ?? "value"`).
- **list mode:** the value must be one of the numeric preset options. Options use the shared numeric-options contract (option.value = a numeric string like `"12.5"`, labelJson `{ru:"12.5%",…}`) via `PercentOptionsEditor` — do NOT reuse `SelectOptionsEditor`, which derives values from labels and would corrupt the numeric contract.

## Aggregation: AVERAGE, not sum — and the two-surface visibility rule
Percent columns aggregate as an **arithmetic mean over records that HAVE a value** (empties ignored) — never a sum. But visibility differs by surface:
- **Flat totals row (общий результат):** shown ONLY when the field's `showColumnTotal` is enabled — same opt-in as number/formula totals. Applies to entity fields AND page-local fields.
- **Group rows (свёрнутые группы):** shown **ALWAYS**, regardless of `showColumnTotal`. Applies to entity + page-local (+ mirror-group, which is the same grouping code with pageId = mirror page).

**Why:** the user explicitly wants the per-column total to be opt-in (avoid clutter) but the per-group summary to always be present. Implementation split: keep an ungated `percentFields`/`gPfPercentFields` for the group pass, and a `showColumnTotal`-gated subset (`percentTotalFields` / page-field filter) for the flat totals pass. Do NOT collapse them back into one list.

**Gotcha:** the page-local group pass loads `page_record_values` behind a guard — that guard MUST include `gPfPercentFields.length > 0`, or a page whose only aggregating page-field is percent gets an empty values map and no group averages.

## list-mode validation compares by NUMERIC equivalence, not string
Use `optionNumbers(optionsJson)` (a `Set<number>`), NOT `optionValues(...).has(String(num))`. The config regex accepts `"12.50"`/`"001"`, which `String(Number(...))` canonicalizes to `"12.5"`/`"1"` → false rejections. Applies to both entity records (`records.ts`) and page-local values (`page-fields.ts`).

**Why:** easy to miss because percent piggybacks on the select-options machinery, but its value contract diverges (numeric options, not label-derived). Was a regression caught in code review.

## i18n
`fields.type.percent` is a TEMPLATE key (`fields.type.${ft.value}`) → invisible to the seed regex, so it (and the percentMode/percentDecimals/percentOptions* keys) MUST be curated in `scripts/src/data/ui-translations.json`. See `erp-i18n.md`.
