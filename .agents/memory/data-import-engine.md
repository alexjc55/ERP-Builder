---
name: Data import engine
description: XLSX/CSV entity data import — boundary reuse and the update-path PUT-parity rule that must never regress.
---

# Data import engine

File-upload-only (XLSX/CSV, no Google connection) dynamic import into an entity's
records, generated from live metadata: download template → upload+parse → map
columns → dry-run preview with per-row errors → commit (insert + upsert-by-key).
Relations resolved by target lookup key (cardinality-aware), with select/user/status
resolution. Gated by RBAC cap `dataImport` (path `/admin/import`), `requireAuth` +
`requireAdmin`. Entity scope only.

## The rule that must never regress: import = record-write parity

Import is NOT a privileged shortcut around validation. Every row goes through the
**same** server boundary a direct record write does, reusing the exact helpers
exported from `records.ts` (`validateValues`, `validateUserRefs`,
`checkDependentValues`, `checkValidationRules`, `checkUniqueKeys`,
`checkImmutableFields`). If a direct edit would reject a value, import must reject it
too.

**Why:** the first cut validated only the *incoming* cells on the update path and
then merged into stored values afterward — so an upsert could bypass cross-field
rules, immutability, and merged-state required-field checks, and the unique-key
check ran outside the write txn (race). That is a silent integrity hole.

**How to apply** — the update (upsert-match) path must mirror `PUT /records/:id`:
- Resolve the upsert match (by key field) and fetch the existing `valuesJson`
  **before** validation.
- Build the candidate the way the matching write path does:
  - UPDATE → compose from **active fields only** (`incoming[key]` else
    `existingValues[key]`). Never spread raw `existingValues` — legacy/stale keys in
    a record's `valuesJson` would trip `validateValues` "Unknown field" (PUT avoids
    this by iterating active fields).
  - INSERT → validate `incoming` directly (like POST create).
- Validate the **merged final state** with `prevValues = existingValues` so
  change-aware rules behave identically; run `checkDependentValues(..., existingId)`,
  `checkValidationRules`, and (update only) `checkImmutableFields(values, existingValues)`.
- Unique-key check runs **inside the write transaction** under
  `pg_advisory_xact_lock(UNIQUE_KEY_LOCK_NS, entityId)`, excluding the matched
  `existingId` — same concurrency guard as PUT/POST. Set `valuesJson = values`
  wholesale (the merged validated map), do not re-merge inside the txn.

## Documented intentional boundary (not a gap)

Workflow status-transition enforcement is **intentionally not applied** on import.
Import is admin-authoritative for status, consistent with how superAdmin bypasses
the transition graph in PUT. Bulk imports legitimately set arbitrary statuses.
This is a deliberate decision, not an oversight.
