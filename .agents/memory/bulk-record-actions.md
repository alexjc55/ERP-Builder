---
name: Bulk record actions
description: Multi-select record actions — partial archive/delete behavior and atomic one-field update boundaries.
---

- Bulk archive/delete results remain per-record, not all-or-nothing: losing page visibility for one record must not roll back another record's successful mutation.
  **Why:** Bulk destructive actions are intentionally equivalent to independent single calls, unlike atomic bulk field edits.
  **How to apply:** Reject a newly hidden row without side effects; report it in failedIds for bulk and as a non-disclosing 404 for a single request. Check both record orders (a success before and after a rejected row).
- Re-read initiating-page status policy after destructive-operation record locks, before dependent-link clearing, archive no-op checks, or version-conflict reporting. Destination allowances never grant row visibility.
  **Why:** Pre-lock authorization can become stale while another transaction holds a record, exposing hidden rows to deletion or archiving; late refusal cannot undo post-commit trash/audit/events.
  **How to apply:** Keep the visibility guard and bookkeeping shared by single and bulk paths. Reload active-user roles and role/page grants on the transaction connection for each locked row; never reuse pre-wait request permissions. Single denials remain non-disclosing, and successful earlier bulk rows stay committed.
- Locked authorization reads must reuse the transaction connection, including field metadata and uncached mirror-page resolution.
  **Why:** Borrowing another pooled connection while holding a transaction can deadlock the entire pool when concurrent destructive requests consume all available connections.
  **How to apply:** Thread the transaction executor through every database-reading helper; test with an isolated one-connection pool and no preloaded mirror context. A warmed request cache must not be required for correctness.
- Visibility denial takes precedence over a stale destructive-operation version.
  **Why:** A conflict response containing the latest version leaks metadata after a record becomes hidden during the lock wait.
  **How to apply:** Test a holder-authored version increment together with access loss and a visible control. Include only the holder's returned row changes in the expected snapshot, never recapture the baseline after the rejected operation.
- UI gating has two intentional paths: destructive bulk actions require the visible actions column plus their normal update/delete gate, while atomic **Edit fields** requires only record-update permission plus at least one field the role may edit. **Why:** hiding per-row actions must not remove a safe accountant-style bulk correction. Keep archive/delete/merge out of the edit-only menu.
- Table layout: the checkbox column is sticky via `insetInlineStart: 0` (works LTR+RTL); existing pinned columns use physical `left`, so the pinned-offset measurement adds the checkbox width in LTR ONLY (in RTL checkbox sticks physically right, pinned stick left — no overlap). Every `<tr>` variant (totals, header, add-row link, adding row, record rows, group headers, empty/loading colSpans) must gain the extra cell/colSpan when bulk mode is on.
- Selection is pruned to the currently loaded result set on records change, so a bulk action never hits rows the user no longer sees.

## Atomic one-field edit

Bulk status-only edits validate the active-field projection, but merge untouched historical/deactivated keys back into storage. Unknown keys introduced by workflow actions still fail validation.

**Why:** Archived records can retain values from deleted fields; an unrelated status change must neither reject nor erase that history.

**How to apply:** Separate historical stored keys before validation, preserve them only when writing a status edit, and keep final workflow/required/immutable/reference checks on active fields. Error labels come client-side only from the selected loaded row's visible fields, never raw server values.

The atomic endpoint also accepts an explicit `statusId` instead of a field/value pair. Never represent the system status as a scalar entity field: manual policy (including administrators), target visibility, workflow role permissions/actions and all selected rows' CAS/scope checks apply. Its audits commit inside the same transaction and status/update events publish only afterward. Same-status rows are true no-ops, not an opportunity to normalize unrelated stored values.

**Why:** JSONB file-key ordering can make validation appear to change unchanged fields and falsely advance a repeated status assignment's version. The UI intersects transitions across selected records (specific transition wins over wildcard) and keeps status available even when no scalar field is editable.

- Atomic edit is deliberately a separate operation from partial archive/delete. It changes exactly one editable entity or page-local field to one shared value across manually selected rows; unsupported computed, relation/lookup, system, file, locked, hidden, and dependent target fields stay excluded.

- **Why:** archive/delete reports individual outcomes by design, but a shared correction such as setting a payment field needs a trustworthy all-or-nothing result. Reusing the partial endpoint would allow a silently mixed state.

- **How to apply:** entity edits must run the normal final-value record-write boundary for every locked row (scope, field access, types, references, dependent/integrity, fill rules, immutability, key uniqueness), then commit audits/events only after the whole transaction succeeds. Page-local edits must preserve unrelated page-value keys; a `page_ref` writes only its source page/field under both target and source boundaries.

- A parent-field no-op must preserve its dependent descendants. First normalize/validate the requested target value, compare it to the stored canonical value, and clear descendants only for an actual parent change.

- **Why:** unconditional child clearing turns a harmless repeated bulk action into data loss.

- **How to apply:** make the comparison server-side after field-type normalization, then revalidate the changed final map if descendants were cleared.

- Page-local `user` values are numeric, positive user IDs and require an existing-user check on every direct and `page_ref` write path.

- **Why:** generic scalar validation otherwise coerces IDs to strings and permits dangling user references.

- **How to apply:** validate their numeric shape and referential existence both before and after locked page-value validation, including the atomic bulk path.
