---
name: page_ref page fields
description: live page-field alias that reads and permission-gated writes another mirror page's local field for the same record
---
A `page_ref` page field on mirror page B is a live alias of a page-local field from another page A with the SAME effective entity — same record, no relation/link involved. Its value may be edited from B, but A remains the only storage authority.

Rules that must stay consistent:
- The source must be another page over the same effective entity and an active supported value-backed field, or a normal per-row formula materialized at read time. Formula aliases are always read-only; grouped formulas are excluded.
- Reads expose the source value under B's alias. Only an explicitly supplied alias may write or clear the source; omission is always a no-op. B never stores an alias copy.
- Both sides are independent permission boundaries. Every explicitly supplied alias, including a same-value no-op, requires target-page/alias edit access plus source-page/source-field/record/row access; otherwise value-dependent success becomes an oracle. Re-check source row scope after locking the entity record, and report denials through only the public alias or a generic row error.
- A write changes only the authoritative source key and preserves unrelated values under concurrency. Multiple aliases to one source may agree; conflicting edits are rejected.
- Source rename/delete/retype integrity must keep aliases valid or remove them safely. Filters and aggregates use the same authoritative source value and boundaries.

**Why:** users need one value to stay synchronized across mirror pages without fake self-relations or duplicated storage. The double boundary prevents B from becoming a permission bypass into A.

**How to apply:** treat `page_ref` as a typed alias and explicit source-key patch, never as a second stored value or as a full-map field. Build reads from the authorized entity-record universe rather than requiring either page to already have a value row.

Hard view filters may reference scalar page aliases. Their source access/row restrictions must be ANDed outside any OR condition group, including empty-value tests. A missing, deactivated, cross-entity or inaccessible source must fail closed rather than drop the filter. Hard view filters do not depend on the quick-filter `isFilterable` flag.

**Why:** A page alias stores no local value; querying its own storage silently produces incorrect rows. Treating an inaccessible source as empty, or OR-ing its access restriction with another condition, exposes restricted information.

**How to apply:** Use the source type and options in the editor while retaining the alias field key in the saved condition; resolve live source storage and recheck both field and page/row boundaries at execution.

For a mapped select edited through an alias, destination policy belongs to the initiating page, not the source storage page. Its all-destinations option may allow a move outside either page's visible statuses. Source-page row visibility and field/page edit access still apply before the write.

**Why:** Storage authority and the employee's workflow page are different concerns. Intersecting both destination lists would unexpectedly restrict handoffs from the initiating page; ignoring source access would make the alias a permission bypass.

**How to apply:** Test differing source/target selections and both all-destinations settings. A source-inaccessible row must reject the whole batch even when the initiating page allows the destination. Preserve the target map and unrelated source values, and never create an alias copy.

Rechecking row access after a record lock must reload both the initiating page's and the source page's status policies, not reuse the request's preflight scope.

**Why:** A page policy can change while a write waits for the record lock. Even an initially unrestricted page can become restricted; checking the locked record against cached metadata would still permit the write. Allowing destination statuses does not grant visibility of the original row.

**How to apply:** Read current policies through the transaction after acquiring record locks for both single and bulk page-local writes, including direct fields and aliases. Use a real observed PostgreSQL lock wait in regression tests. Preserve generic not-found denials and full rollback; this is a row-read boundary, independent of allowed destination statuses.
