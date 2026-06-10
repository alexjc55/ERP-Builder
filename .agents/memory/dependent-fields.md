---
name: Dependent (cascading) fields
description: Variant-A "Зависимые поля" — string suggestions scoped by a field's parent chain, with create-time dedupe and scoped rename/merge.
---

# Dependent (cascading) fields — Variant A

A `text` field can opt into a dependency on another field of the same entity via
`fields.dependencyConfigJson.dependsOnFieldKey`. Its value is then a free string,
but suggestions are the distinct existing values of that field scoped to the
record's **parent-chain** values (closest parent + all ancestors).

## Invariants that must stay consistent

- **Chain computation is duplicated client+server and must stay in lockstep.**
  Server `dependencyAncestorKeys` (records.ts) and client `dependencyChainKeys`
  (EntityRecords.tsx) walk the same closest-parent-first, cycle-guarded chain.
  If you change one, change the other or the option/rename scope diverges.

- **Dedupe rule (server-authoritative, in `checkDependentValues`, wired into
  record create AND update):** exact match → reuse OK; case-insensitive-only
  collision → REJECT; brand-new value → OK; a dependent value with an empty
  immediate parent → REJECT. On update, pass `excludeRecordId` so a row doesn't
  collide with itself. The client add-new box pre-checks the same rule for UX,
  but the server is the boundary.

- **Two POST-only endpoints** under `/entities/{entityId}/fields/{fieldId}`:
  `dependent-values` (read; returns distinct scoped values, `ORDER BY` ordinal
  `1` because the reused sql value-expression frag re-binds params if
  re-interpolated) and `rename-value` (write/merge).

- **Both endpoints mirror the records read boundary**: field hidden/edit access,
  `effectiveScope` own-row scope, `archivedWhere("active")`, and
  `hiddenRowStatusWhere(...)`. **Why:** rename-value originally omitted the
  archive + hidden-status filters, so a direct API call could silently rewrite
  rows the role can't see. Any new code path that touches dependent values must
  re-apply this same parity.

- **`rename-value` IS the merge mechanism, not a dedupe violation.** When the new
  value case-collides with an existing distinct value the result is a deliberate
  consolidation; the merge confirmation is client-side. Do NOT add a
  reject-on-collision guard to rename — that would break the feature. The dedupe
  guard belongs only on record create/update.

- **Parent change must clear children at every edit surface.** add-row, the
  record dialog, and inline cell edit all run `clearDependentDescendants` so a
  changed parent wipes now-mismatched child values. Inline edit (`commitCell`)
  sends only the changed key by default, so it must add the cleared descendant
  keys to the same `valuesJson` payload — easy to forget.
