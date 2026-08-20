---
name: Bulk record actions
description: Multi-select record actions — partial archive/delete behavior and atomic one-field update boundaries.
---

- POST /records/bulk re-checks EVERY record individually against the same boundary as the single endpoints: entity cap via assertRecord (delete honours mirror pageId, archive = update cap without pageId, parity with singles), then per-row own-scope; wrong-entity/missing/unowned ids go to failedIds, never 403 the batch. No transaction on purpose — each record's outcome is independent, like N single calls.
- Single delete/archive cores are extracted (performRecordDelete / applyArchiveFlag) and shared with bulk; they perform NO permission checks — callers must have checked already. Any new bookkeeping (audit/trash/events/archiveExempt) goes in the core so single+bulk can't drift.
- UI gating: bulk mode is offered only when the actions column is visible for the role (hideActionsColumn hides bulk too) AND canUpdate||canDelete; per-action menu items follow canUpdate/canDelete.
- Table layout: the checkbox column is sticky via `insetInlineStart: 0` (works LTR+RTL); existing pinned columns use physical `left`, so the pinned-offset measurement adds the checkbox width in LTR ONLY (in RTL checkbox sticks physically right, pinned stick left — no overlap). Every `<tr>` variant (totals, header, add-row link, adding row, record rows, group headers, empty/loading colSpans) must gain the extra cell/colSpan when bulk mode is on.
- Selection is pruned to the currently loaded result set on records change, so a bulk action never hits rows the user no longer sees.

## Atomic one-field edit

- Atomic edit is deliberately a separate operation from partial archive/delete. It changes exactly one editable entity or page-local field to one shared value across manually selected rows; unsupported computed, relation/lookup, system, file, locked, hidden, and dependent target fields stay excluded.

- **Why:** archive/delete reports individual outcomes by design, but a shared correction such as setting a payment field needs a trustworthy all-or-nothing result. Reusing the partial endpoint would allow a silently mixed state.

- **How to apply:** entity edits must run the normal final-value record-write boundary for every locked row (scope, field access, types, references, dependent/integrity, fill rules, immutability, key uniqueness), then commit audits/events only after the whole transaction succeeds. Page-local edits must preserve unrelated page-value keys; a `page_ref` writes only its source page/field under both target and source boundaries.

- A parent-field no-op must preserve its dependent descendants. First normalize/validate the requested target value, compare it to the stored canonical value, and clear descendants only for an actual parent change.

- **Why:** unconditional child clearing turns a harmless repeated bulk action into data loss.

- **How to apply:** make the comparison server-side after field-type normalization, then revalidate the changed final map if descendants were cleared.

- Page-local `user` values are numeric, positive user IDs and require an existing-user check on every direct and `page_ref` write path.

- **Why:** generic scalar validation otherwise coerces IDs to strings and permits dangling user references.

- **How to apply:** validate their numeric shape and referential existence both before and after locked page-value validation, including the atomic bulk path.
