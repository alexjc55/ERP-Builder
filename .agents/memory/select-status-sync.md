---
name: Select-to-status synchronization
description: Integrity and authorization rules when an entity select option drives the record system status.
---

An entity select option may map its stable stored value to a status of the same entity. Apply the mapping only when that select value changes; page-local fields never drive entity status.

**Why:** Treating the mapping as UI convenience or a later automation can leave the field and system status inconsistent, especially during bulk edits, concurrent saves, workflow actions, or partial failures.

**How to apply:** Resolve the mapping from final validated values while the record is locked. Persist values, status timestamps, and archive side effects atomically; enforce status ownership, visibility, row visibility, workflow transitions/roles/actions/required fields, CAS, audit, and events exactly like an explicit status change. Reject explicit, multi-field, or post-workflow mapping conflicts instead of choosing by field order. Bulk field changes are all-or-nothing across selected rows.