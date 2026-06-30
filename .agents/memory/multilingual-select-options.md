---
name: Multilingual select options
description: How select-field options are modeled (stable value + multilingual labelJson) and the invariants every consumer must honor.
---

A select option is `{ value: string; labelJson: {ru,en,he} }`. Records store ONLY
the stable `value` string (storage shape unchanged from the legacy `string[]` era).
Display = `ml(labelJson)` with ru→en→he fallback, falling back to the raw `value`
when an option is orphaned/unknown.

**Why:** records used to store the raw option label; renaming an option orphaned
old records. Splitting into a stable key + display label makes renames edit only
`labelJson`, so the new label shows across ALL existing records.

**Invariants (must stay consistent server + client):**
- `value` is assigned once at option creation and is NEVER recomputed from an
  edited label. New options arrive client-side with `value:""`; the server
  (`sanitizeOptionsInput`) derives the value from the ru→en→he label text and
  dedupes (`value`, `value_2`, …). So new-option values equal the ru label text.
- Legacy plain-string options normalize to `{value:s, labelJson:{ru:s}}` (value
  == old stored text → existing record values stay valid). All readers stay
  tolerant of legacy entries via the normalize helper.
- Helpers: server `lib/selectOptions.ts` (normalizeOptions, optionValues set,
  matchOption by value-or-any-label, sanitizeOptionsInput); client
  `lib/selectOptions.ts` (normalizeSelectOptions, getOptionLabel(raw,value,ml)).
- Every UI picker/dropdown stores `option.value` and displays the label; never
  store a label. Write-path select validation matches against `optionValues`.

**How to apply:** when adding a new consumer of a select field, run
`normalizeSelectOptions(field.optionsJson)`, render `ml(o.labelJson) || o.value`,
and persist `o.value`. For relation/lookup fields projecting onto a select, the
options live on the LINKED (projected) field, not the relation field itself —
resolve labels from the projected field's optionsJson.

**Accepted limitations:** PivotView row/col labels are server-computed
(`r.label`/`c.label`) so they show the value (= ru text), not the viewer's locale.
`recordLabel()` returns the raw stored value for the same reason. Both are
acceptable because the value equals the ru label.
