---
name: Lookup double-hop (chained lookup)
description: A lookup/relation field projecting a value through the TARGET record's own relation/lookup field, and the invariants that keep it safe.
---

# Lookup double-hop (chained resolution)

A `lookup` / `relation` field projects the linked record's value for the chosen field. When that chosen field is
ITSELF an entity-source relation/lookup, the linked record has no scalar stored for it, so a naive read yields NULL.
The double-hop follows that inner field one more hop (recursively) to a terminal scalar, and the column then renders
using the TERMINAL field's type/options (so the client needs no change). Chained lookups are display-only and never
write-through.

**Why:** users wanted a lookup to read another lookup's value across a relation instead of maintaining a duplicate
manual picker; the two-hop data chain already existed but resolved to null.

## Invariants (do not regress)
- **Every hop re-applies the full read boundary**: related-entity record-view, projected-field hidden access,
  related own-row scope, and hidden-row-status exclusion. A deeper hop must NEVER surface a value the viewer could
  not read directly. If any hop is field-hidden, the whole column is hidden and no `linkedRecordId` leaks.
- The recursive resolver and the inline first-hop path must stay in **lockstep** — they duplicate the same boundary
  logic. There is currently NO test guarding this; changing one side means re-checking the other by hand.
- Both related-values endpoints (page-source and entity-source) must invoke the chain identically.
- Recursion is bounded by a max-hops cycle guard; page-source projections are always terminal.

## Scope limit (v1)
- Display path ONLY. Filter/sort/pivot read stored `values_json` and return null for a chained lookup, so chained
  columns are effectively unfilterable/unsortable until that path learns the same recursion.
