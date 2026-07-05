---
name: Conditional formatting text color
description: Why per-field conditional-formatting text color must be applied inline on content spans, not on the cell <td>.
---

Conditional formatting supports a per-rule `textColor` (alongside row/cell background) on `FieldFormatRule`. `formatRules.ts` exposes it as `cellTextColors[fieldKey]` on `RowFormatting`.

**Rule:** apply `textColor` as an inline `style={{ color }}` on the actual text-bearing content nodes, NOT only on the wrapping `<td>`.

**Why:** the records table renders cell content through `renderCellValue` and the function-output branch, which hardcode Tailwind text classes (`text-slate-700`, `text-slate-300`, `text-red-400`, status `Badge` colors). A `color` set on the `<td>` is *inherited*, and a Tailwind `text-*` class on a child wins over inherited color — so the rule appeared to do nothing. Inline `style` beats the class, so the color must be threaded down to the spans.

**How to apply:** `renderCellValue` takes an optional `textColor` param and applies it inline to its text spans (normal text, user name, em-dash placeholder). Status/boolean badges are intentionally left with their semantic palette. The function-output spans apply `cellText` inline too. Both the entity-field and page-field render paths must pass `cellText` through — keep them in lockstep.

## Conditional formatting must evaluate the DISPLAYED value, not raw valuesJson
**Rule:** the `getValue` callback feeding `computeRowFormatting` must resolve each field the same way the cell is rendered. For `relation`/`lookup` fields the value is NOT in the row's `valuesJson` — it is projected from the linked record and held in separate state maps (`entityRelatedByRecord` for entity fields, `relatedByRecord` for page-relation fields), the same `rel.value` passed to `renderCellValue`. Reading only `allValues`/`fieldRawValue` returns `undefined`, so every rule (equals/contains/gt/…) silently evaluates against empty and never matches.
**Why:** projected fields are a parallel value source to `valuesJson`; any per-row computation (formatting, totals, filters) that assumes "value = valuesJson[key]" is wrong for relation/lookup and will treat them as blank. **How to apply:** in `getValue`, branch on `def.fieldType` and pull from `entityRelatedByRecord` first, then `relatedByRecord`, before falling back to `fieldRawValue(allValues)`. (`function` fields are likewise computed, not stored — handled by `fieldRawValue`.) Empty/unlinked rows correctly stay `undefined` so `empty`/`notEmpty` still work; a `user` projection compares the stored id, not the display name.

## Operator availability is per field type; formula fields hold text OR numbers
**Rule:** `operatorsForType` in `FieldFormatRulesEditor` gates which `FormatOperator`s appear per field type. `number`/`percent` are always-numeric → comparison + range set (`gt/lt/gte/lte/between`, no substring). `function` (formula) can return either text or a number, so it gets the **union**: `contains/notContains` AND the numeric/range ops. The per-value `<Input type>` for a formula follows the chosen operator (numeric op → `number`, else `text`), not the field type alone — a text formula using `contains` must stay a text input.
**Why:** the reported bug was "formula field only offers равно/содержит/пусто" — formula fell into the text-only default branch, so numeric comparisons weren't even selectable. **How to apply:** when adding a numeric-producing field type, add it to the numeric branch; never force a single input type for polymorphic (function) fields.

## Range operator `between` uses a second bound `value2`
**Rule:** `between` is inclusive and reads BOTH `value` (lower) and `value2` (upper) from `FieldFormatRule`. `ruleMatches` normalizes order via `min/max` (bounds may be entered reversed) and returns `false` if the cell value or either bound is non-numeric. The editor renders two inputs (от/до) only for `between`.
**Why:** "highlight when value is between 0 and 100" cannot be expressed with two independent single-bound rules — first-match-wins makes them OR, not a range. **How to apply:** `value2` lives INSIDE the `format_rules_json` JSONB (whole-object persistence), so adding it needed only the `FormatOperator`/`FieldFormatRule` source-of-truth (`lib/db` + `openapi.yaml`) + codegen — NO DB migration and NO PUT allowlist change. Conditional formatting is cosmetic and evaluated client-side; the server just stores the array.

## A `user` field's rule value must be the user id, picked from a list — not free-typed
**Rule:** because a `user` cell is matched by its stored **id** (the displayed name is only a label resolved via `userNames`), the rule-config UI must offer a user **dropdown** that stores `String(id)`, and restrict operators to identity/presence (`equals`/`notEquals`/`empty`/`notEmpty`). A free-text input lets an admin type the name, and `ruleMatches(String(id), name)` silently never matches.
**Why:** the bug "conditional formatting on a user field does nothing" came from exactly this id-vs-name mismatch in the editor, masked by the cell rendering the name. **How to apply:** any value-input editor for a field whose stored value differs from its display (user, and by extension relation/lookup-projecting-user) must feed the editor the same id space the row computation compares against. Pass the users list (`useListUserOptions`) into the shared format-rules editor from BOTH the entity and page-field dialogs.
