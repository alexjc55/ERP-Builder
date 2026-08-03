---
name: Record merge (duplicates)
description: How the superAdmin merge-duplicates endpoint keeps links, values, files and integrity consistent.
---
- POST /records/merge (superAdmin only): merge N source records into a target of the same entity.
- Link repoint runs in ONE tx with the affected relation rows locked FOR UPDATE (same rows the shared link core locks) — dedupe by (relationId,source,target) pair set, and on unique sides (source_one: one_to_one/many_to_one; target_one: one_to_one/one_to_many) the target's OWN existing link always wins; self-links dropped.
- Values are fill-empty ONLY (target's values never overwritten; relation/lookup/function skipped); page_record_values merged the same way per page. Inherited isKey values are re-checked under the same pg_advisory_xact_lock namespace, excluding target+sources (they're being deleted).
- Sources are deleted AFTER the tx via the shared performRecordDelete core (non-transactional by design, like bulk); file values inherited by the target are stripped from the delete snapshot so the trash purge can't destroy the surviving record's files.
- **Why:** merge is admin-authoritative (like data import) — workflow/own-scope/cross-field validation intentionally not enforced; the target update event carries the filled fieldKeys as changedFields so field_changed automations fire.
