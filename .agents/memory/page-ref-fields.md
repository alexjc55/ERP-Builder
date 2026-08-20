---
name: page_ref page fields
description: live page-field alias that reads and permission-gated writes another mirror page's local field for the same record
---
A `page_ref` page field on mirror page B is a live alias of a page-local field from another page A with the SAME effective entity — same record, no relation/link involved. Its value may be edited from B, but A remains the only storage authority.

Rules that must stay consistent:
- The source must be another page over the same effective entity and an active supported value-backed field.
- Reads expose the source value under B's alias. Only an explicitly supplied alias may write or clear the source; omission is always a no-op. B never stores an alias copy.
- Both sides are independent permission boundaries. Writing requires target-page/alias edit access plus source-page/source-field/record/row access; stale sources remain read-only and direct requests are rejected.
- A write changes only the authoritative source key and preserves unrelated values under concurrency. Multiple aliases to one source may agree; conflicting edits are rejected.
- Source rename/delete/retype integrity must keep aliases valid or remove them safely. Filters and aggregates use the same authoritative source value and boundaries.

**Why:** users need one value to stay synchronized across mirror pages without fake self-relations or duplicated storage. The double boundary prevents B from becoming a permission bypass into A.

**How to apply:** treat `page_ref` as a typed alias and explicit source-key patch, never as a second stored value or as a full-map field.
