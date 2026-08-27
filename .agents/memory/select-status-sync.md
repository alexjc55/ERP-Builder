---
name: Select-to-status synchronization
description: Integrity and authorization rules when an entity select option drives the record system status.
---

An entity select option may map its stable stored value to a status of the same entity. Apply the mapping only when that select value changes; page-local fields never drive entity status.

**Why:** Treating the mapping as UI convenience or a later automation can leave the field and system status inconsistent, especially during bulk edits, concurrent saves, workflow actions, or partial failures.

**How to apply:** Resolve the mapping from final validated values while the record is locked. A mapped status is an admin-configured system consequence: it bypasses the editor's target-status picker visibility and transition role list, but still requires record/field access and enforces source-row visibility, transition graph/actions/required fields, CAS, archive, audit, and events. Forms must omit untouched seeded/current `statusId` and send it only after a real picker change, preserving explicit-conflict detection. Reject multi-field or post-workflow mapping conflicts instead of choosing by field order. Bulk field changes are all-or-nothing across selected rows.