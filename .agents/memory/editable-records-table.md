---
name: Editable records table
description: Constraints for the Google-Sheets-style inline-editable records table (EntityRecords) and its column setup mode.
---

# Editable records table (EntityRecords)

The records data table is directly editable (Airtable/Sheets style), layered on the
existing modal create/edit dialog which is kept as a fallback:

- **Inline cell edit** — clicking an `edit`-access cell opens an in-place editor; text/number/date
  commit on Enter/blur, Esc cancels; boolean toggles immediately; select/user commit on choice.
  Saves send a **partial** `valuesJson` (server merges).
- **Inline add-row** — a draft row at the bottom of the tbody; uses the record create endpoint.
- **Setup mode** — admin-only (`canAdmin("entities")`) toggle; column headers become buttons that
  open a shared `FieldConfigDialog` (field props + per-role access), and a "+" header button creates
  a new field/column.

## Rule: inline status editing must mirror the server workflow boundary per-row
When an entity has workflow transitions defined AND the row has a non-null status AND the actor is
not superAdmin, the status is **workflow-active**: it cannot be cleared and only allowed-transition
targets may be offered. Gate the inline status "Без статуса" option on a **per-row workflow-active
check**, NOT on a heuristic like "allowed list length equals total status count".

**Why:** an array-length heuristic can be true even while workflow enforcement is active (e.g. transitions
cover every status), letting the client offer setting status to null which the server rejects (422/403).
Caught in code review.

**How to apply:** reuse the per-row helper that returns whether workflow is active for a record, and use
it both to filter allowed targets and to decide whether to show the clear/"no status" option — matching
the modal edit dialog's existing `workflowActive` gating.

## Rule: table-editing UI must render even with zero records
Keep the table header + inline add-row trigger/draft visible in the empty state (render the empty
message as a row inside the tbody, not as a replacement for the whole table). Otherwise inline add-row
and setup-mode column tools are unreachable in the common "no rows yet" bootstrap case.
