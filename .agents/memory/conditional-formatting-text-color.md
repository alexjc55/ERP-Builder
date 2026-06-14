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
