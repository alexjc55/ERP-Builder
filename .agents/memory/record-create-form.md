---
name: One shared record create/edit form
description: RecordFormBody is the single form body for ALL record dialogs, including the quick-create related-record dialog.
---

# One shared record form body

`RecordFormBody` (EntityRecords.tsx) is the ONE body for every record dialog: the main add/edit dialog, the write-through `RecordEditModal`, and the quick-create related-record dialog (`QuickCreateRelatedRecordDialog`). Never fork a second per-field rendering/filtering loop.

**Why:** the quick-create dialog used to have its own field filter and drifted twice from the main form (missed `isActive` and per-role display-only hide). Same principle as the single field editor (`FieldConfigDialog`).

**How to apply:**
- Field-set computation must mirror the main form's `visibleFormFields`: `isActive` + sortOrder sort + `fieldAccess !== "hidden"` + per-role display-only hide (hidden for EVERY assigned role drops the field even for superAdmin).
- Caller-specific behavior goes through props, not a fork: `lockedFieldKeys` forces read-only (scalar → disabled input; relation in create mode → read-only `#id` box, link set after create).
- Create flows send entity relation-picker selections as `RecordInput.relationSelections` (including single parent selections). The server persists them parent-first atomically with the record BEFORE `record.created`; do not reintroduce separate post-create entity link calls. Relations never live in valuesJson; `formToValues` skips relation/lookup/function.
- Quick-create mirrors the main create dialog's status logic: hidden-picker statuses dropped, default preselected unless hidden, and when the default is hidden + NO_STATUS the payload OMITS `statusId` so the server assigns the hidden default.

## Contextual quick-create dependencies

Creating a related record inside an existing context must prefill and lock the
entire configured ancestor chain, not just the immediate parent.
**Why:** The user expects items created inside a delivery/order to inherit client,
project and order, but explicitly requires a reusable mechanism rather than
business-field-name special cases.
**How to apply:** Walk dependency mappings using authorized source values and
linked IDs; stop submission on missing/inaccessible context or cycles. User-valued
lookups must use their actual source/terminal type to display names, never assume
that all primitive values are text.
