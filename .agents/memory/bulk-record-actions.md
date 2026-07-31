---
name: Bulk record actions
description: Multi-select archive/unarchive/delete over records — boundary and table-layout rules.
---

- POST /records/bulk re-checks EVERY record individually against the same boundary as the single endpoints: entity cap via assertRecord (delete honours mirror pageId, archive = update cap without pageId, parity with singles), then per-row own-scope; wrong-entity/missing/unowned ids go to failedIds, never 403 the batch. No transaction on purpose — each record's outcome is independent, like N single calls.
- Single delete/archive cores are extracted (performRecordDelete / applyArchiveFlag) and shared with bulk; they perform NO permission checks — callers must have checked already. Any new bookkeeping (audit/trash/events/archiveExempt) goes in the core so single+bulk can't drift.
- UI gating: bulk mode is offered only when the actions column is visible for the role (hideActionsColumn hides bulk too) AND canUpdate||canDelete; per-action menu items follow canUpdate/canDelete.
- Table layout: the checkbox column is sticky via `insetInlineStart: 0` (works LTR+RTL); existing pinned columns use physical `left`, so the pinned-offset measurement adds the checkbox width in LTR ONLY (in RTL checkbox sticks physically right, pinned stick left — no overlap). Every `<tr>` variant (totals, header, add-row link, adding row, record rows, group headers, empty/loading colSpans) must gain the extra cell/colSpan when bulk mode is on.
- Selection is pruned to the currently loaded result set on records change, so a bulk action never hits rows the user no longer sees.
