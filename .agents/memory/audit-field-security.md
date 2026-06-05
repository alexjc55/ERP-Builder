---
name: Audit endpoint field-level security
description: Any endpoint that returns historical/raw stored values (audit log, snapshots) must re-apply the field-level hidden boundary — record-level gating is not enough.
---

# Audit / history endpoints must mirror the field-level hidden boundary

The record CRUD endpoints strip hidden fields per requester (`resolveFieldAccess` ⇒ `hidden` set, then `stripHidden`). Any *other* endpoint that surfaces stored values must re-apply the same boundary, or it becomes a side-channel that leaks fields a role cannot see.

**Why:** the audit history endpoint originally returned raw `audit_log` rows after only record-level (`view` + ownership) gating. That leaked `oldValue/newValue` for hidden data fields, and the `__deleted__` marker (which stores a full JSON snapshot of the record's values) leaked every hidden field at once.

**How to apply:** in the read handler, load the entity's active fields, compute the requester's `hidden` set the same way records.ts does, then (1) drop entries whose `fieldKey` is a hidden data field, and (2) for reserved keys that embed a values snapshot (`__deleted__`), parse the JSON and delete hidden keys before returning. Reserved non-data keys (`__status__`, `__archived__`, `__created__`) are never field data, so they pass through. Verify with a role that has a field hidden: it must see neither the field's entries nor its value anywhere in the response.
