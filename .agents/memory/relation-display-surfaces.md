---
name: Relation/lookup display across record surfaces
description: Any surface rendering entity records must resolve relation/lookup fields via the related-values endpoint, not valuesJson.
---

# Relation/lookup display across record surfaces

Relation and lookup fields do NOT store a scalar in a record's `valuesJson` — their display value is projected from
the linked record and only comes back from the entity-keyed related-values endpoint (which re-applies the related
entity's field/row/status RBAC boundary server-side). Reading `valuesJson[fieldKey]` for such a field yields
null/empty, so a naive renderer shows nothing or an id-based fallback.

**Rule:** every NEW surface that displays record field values (table, calendar, cards, exports, etc.) must resolve
relation/lookup fields the same way the records table does: fetch related-values for the visible record ids, then
render with a synthetic field whose type/options come from the returned column meta (`relatedFieldType`/`optionsJson`).
Pass the page context (`pageId`) so the permission scope matches the table.

**Why:** the calendar view originally read `valuesJson` directly, so a relation title rendered as "<FieldName> #<id>"
and relation plaque fields silently disappeared. The fix mirrored the table's proven related-values resolution.

**How to apply:** when building a records-rendering view, branch on `fieldType === "relation" || "lookup"` and pull
the value from the related-values map (keyed recordId→fieldKey), never from `valuesJson`.

## Per-field display options apply to relation/lookup cells too

The relation/lookup table-cell branch is a SEPARATE render path from plain scalar cells, so per-field display
options (e.g. `wrapText`) must be wired there explicitly — including the assignable-relation picker trigger
(its label span needs a wrap/truncate toggle prop). **Why:** `wrapText` was honored only by the scalar cell
branch; lookup columns kept a hardcoded `truncate` and never wrapped. **How to apply:** when adding a per-field
table-display option, grep every `<td>` branch in the records table (scalar, function, relation/lookup, picker
trigger) and thread the flag through each; page-local fields have no such column and stay out of scope.

## Create-time lookup preview (2026-08)
- record_links are stored per relationId with NO field key: several relation fields of one entity can surface the SAME relation. Any create-time resolver mapping relationId → relation-field value must scan ALL such fields (first Map.set-wins picked the wrong/empty one → blank lookup previews); if two drafts hold DIFFERENT ids the preview is ambiguous — render nothing.
- Formula ("function") fields now compute LIVE in the record form and inline add-row from current draft values (buildFormulaScope over form state, user ids → names); a caller-locked relation in quick-create previews the target's display field via LookupCreatePreview, never `#id`.
