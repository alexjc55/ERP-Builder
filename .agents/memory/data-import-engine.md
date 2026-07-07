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

## Batch engine: multi-file, topo-ordered, all-or-nothing (Variant B)

Import takes MANY files at once and runs them as ONE batch inside a single outer
transaction. `POST /import/preview` always rolls the outer tx back (dry run);
`POST /import/commit` rolls back if ANY row across ANY file errored — all-or-nothing
per batch (not per file, not per row).

- **Ordering:** entity files are Kahn topologically sorted by their relation edges
  (`target -> source`), so a file whose rows link to another same-batch file is
  written after its dependency; page files run last (they look up already-written
  host records). This makes same-batch relation targets and page hosts resolvable.
- **Per-row isolation:** each row writes inside a nested `tx.transaction` (SAVEPOINT)
  so a single row's DB error is caught and collected without aborting the outer tx;
  the batch keeps validating every row to report all errors, then commit/preview
  decides the final rollback. Do not confuse per-row SAVEPOINT rollback (error
  collection) with the batch-level rollback (all-or-nothing gate).
- **Deadlock avoidance:** advisory locks (`pg_advisory_xact_lock`) are taken up-front
  for the DISTINCT entity ids across all entity files, acquired in sorted id order
  before any row write, so concurrent batch imports serialize their unique-key checks
  in a consistent lock order.

## Page-local value import ("page" file kind, Variant C inside B)

**Acceptance requirement — keep the downloadable error-report CSV.** The batch
result UI MUST offer a "download errors" CSV (combined across all files: file
label/target, row index, message), shown when the batch has errors. Do NOT drop
this in favor of inline-only error tables — a review will reject the rework.

**UX — the card is the unit, not the file.** The wizard entry is "add a card",
then per card: pick the target (entity / mirror page) → download its template →
attach the filled file. Templates are target-derived, so they MUST be reachable
before any file exists (the old "upload first, template appears inside the card"
flow confused users). Bulk "upload ready files" stays as a secondary shortcut
that creates pre-filled cards.

A file's `kind` is `entity` or `page`. A page file targets a mirror page
(`mirrorEntityId != null`): it locates the host record on the MIRRORED entity by a
chosen `hostKeyFieldKey` (mapped as a hostkey column), then coerces + `validatePageValues`
(from `page-fields.ts`) and MERGEs existing ⊕ cleaned into `page_record_values`
(unique `pageId,recordId`). Missing/ambiguous host → row error. Page values are
admin-authoritative like the rest of import (see intentional-boundary note below);
they reuse the page-field TYPE validation, not the interactive own-scope path.

## Documented intentional boundary (not a gap)

Workflow status-transition enforcement is **intentionally not applied** on import,
and neither is per-row `own`-scope / `assertRecord` gating (for entity OR page files).
Import is admin-authoritative bulk seeding gated by the privileged `dataImport` cap —
consistent with how superAdmin bypasses the transition graph in PUT and how
dashboards/pivots are admin-authoritative. Bulk imports legitimately set arbitrary
statuses and seed rows regardless of row ownership. A code review will flag this as
"broken access control" if it evaluates against generic full-write-boundary reuse;
it is a deliberate decision. What import DOES reuse is the full **validation** boundary
(the parity rule above). Both the pre-batch and batch engines behaved this way.
