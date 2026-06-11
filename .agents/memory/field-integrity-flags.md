---
name: Field integrity flags (isKey / lockAfterCreate)
description: Durable rules for per-entity-field uniqueness and immutability enforcement on the records write path.
---

Two per-entity-field boolean flags on `entity_fields`: `isKey` (value unique within the entity) and `lockAfterCreate` (value immutable once a non-empty value is stored). Both are invalid for `file`/`function` field types (rejected on field create + PUT, and the UI hides the toggles).

## isKey uniqueness
- Case-insensitive (trim+lower), global **within the entity**, with **no archive/visibility filter** — a key must stay unique even against archived/hidden rows, otherwise unarchiving could resurrect a duplicate.
- MUST be verified inside the write transaction under `pg_advisory_xact_lock(NS, entityId)`: lock → check → write all share the same `tx` connection, or two concurrent writes can both pass the check and insert a dup. App-level (not a DB unique index) because values live in a shared JSONB column.
- Update path excludes the row being edited (`excludeRecordId`) so it never collides with its own stored value.
- Empty values are never unique-checked (multiple blanks allowed).
- Enabling `isKey` on an existing field scans for current duplicates and 409s if any exist.
- **Why blocked:** renaming `fieldKey` *and* enabling `isKey` in one PUT is rejected — existing record values are still stored under the OLD key, so a dup scan can't reflect the effective final state. Do it as two steps.

## lockAfterCreate immutability
- **Why the placement matters:** the check MUST run on the FINAL `update.valuesJson` — i.e. AFTER workflow `set_field` transition actions have been applied — not on the user-submitted values. Workflow actions mutate `update.valuesJson` later on the update path; checking earlier lets a transition action silently bypass the lock.
- STRICT: no superAdmin exception. First non-empty save is allowed; any later change OR clear is rejected (422). Compare via `JSON.stringify(newV ?? null) !== JSON.stringify(oldV ?? null)`. Fix for a mistakenly-set value = delete + recreate the record.

## How to apply
- Any new code path that writes record values (bulk import, automation, future modules) must route through the same uniqueness-in-txn-under-lock and final-values immutability guards, not re-implement a weaker version.
