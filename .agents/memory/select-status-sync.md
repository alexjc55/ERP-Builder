---
name: Select-to-status synchronization
description: Integrity and authorization rules when an entity select option drives the record system status.
---

An entity or page-local select option may map its stable stored value to a status of the owning entity. Apply the mapping only when that select value changes; an entity-less page cannot define status mappings.

**Why:** Treating the mapping as UI convenience or a later automation can leave the field and system status inconsistent, especially during bulk edits, concurrent saves, workflow actions, or partial failures.

**How to apply:** Resolve the mapping from final validated entity/page values while the entity record is locked. A mapped status is an admin-configured system consequence: it bypasses target-status picker visibility, manual-status policy, and transition role lists, but still requires source record/field/page access and enforces source-row visibility, transition graph/actions/required fields, CAS, archive, audit, events, and file cleanup. Forms must omit untouched seeded/current `statusId` and send it only after a real picker change. If an API client supplies both a changed mapped select and the same explicit `statusId`, treat it as mapped; reject a different explicit status as a conflict. Reject multi-field or post-workflow mapping conflicts instead of choosing by field order. Bulk changes are all-or-nothing across selected rows.

Page-selected statuses are not merely picker visibility: mapped transitions must also respect the page's destination restriction unless its all-destinations option is enabled.

**Why:** Bypassing manual picker restrictions for an administrator-configured mapping must not silently bypass a department page's explicitly restricted destinations.

**How to apply:** Check page policy for entity and page-local select writes, single and bulk. Enabling all destinations may allow a mapped move outside the page but must not widen the rows subsequently returned by that page.