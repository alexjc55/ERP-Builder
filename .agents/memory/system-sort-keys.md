---
name: Reserved system sort keys
description: Sorting records by the row's system creation date / id via reserved sort keys that bypass the entity-field whitelist.
---

# Reserved system sort keys

Records can be sorted by their system columns (`entity_records.createdAt`,
`entity_records.id`) via two reserved sort-field keys: `__created_at__` and
`__record_id__`. They are sortable in views + default sort but are NEVER rendered
as table columns (they are not entity fields).

## Invariants

- The two literals are duplicated in three places and MUST stay in lockstep:
  the server sort builder (`record-query.ts`), `EntityRecords.tsx`
  (`SYSTEM_SORT_KEYS`, used so a stored default sort on a reserved key isn't
  dropped by the "unknown field" filter), and the `entity-views.tsx` sort
  dropdowns (view editor + default-sort dialog only — NOT the filter dropdown).

- **The reserved keys must be matched BEFORE the entity-field whitelist lookup**
  in `buildRecordQuery`, and map only to fixed Drizzle column refs. **Why:** the
  whitelist is the security boundary against raw field-name interpolation; the
  reserved path stays safe because it never reaches user input — it resolves to a
  hardcoded column. Any future reserved key must follow the same fixed-column
  pattern.

- No DB migration was needed — `id` (serial PK) and `createdAt` (defaultNow)
  already exist on every record; this feature only exposes them for ordering.
  Typical use: a stable tie-breaker so rows sharing a business date keep their
  insertion order.
