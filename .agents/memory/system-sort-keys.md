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

## Deterministic id tie-break (always)

`buildRecordQuery` ALWAYS appends an `id` tie-break to the ORDER BY: same
direction as a `__created_at__` sort, `id DESC` for the empty-sorts default,
and a trailing `id DESC` after custom field sorts.
**Why:** a bulk SQL import runs in ONE transaction, so `now()` gives every
inserted row an IDENTICAL `created_at`; sorting by date alone returns those
rows in arbitrary, pagination-unstable order. **How to apply:** never emit an
ORDER BY on records without an id tie-break; for already-imported batches on
an external DB, a one-off SQL can spread duplicate `created_at` groups by
milliseconds in `id` order (id order = insertion/file order).
