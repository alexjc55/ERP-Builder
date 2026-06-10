---
name: List reorder pattern
description: How sortOrder reordering is done across admin builders, and why it must be a single transactional endpoint.
---

# Arrow-based list reordering

All admin builders with a `sortOrder` (pages, fields, statuses, record views,
workflow transitions) expose up/down arrow reordering. The move helper sends the
new desired order to a dedicated `*/reorder` POST endpoint (body
`{ entityId, items: [{id, sortOrder}, ...] }`). Arrows are disabled at list
boundaries and while the mutation is pending.

**Renumber the whole list, do NOT swap two values.** The records column reorder
(`moveColumn`/`movePageColumn`) used to swap just the two adjacent siblings'
`sortOrder` values. That silently no-ops whenever two rows share the same
`sortOrder` (duplicate/tie values DO occur in real data — fields can be created
with colliding `sortOrder`), because swapping equal values changes nothing and the
refetch returns the same order → "arrows do nothing" bug. Fix: splice the moved
item into its new index and reassign sequential `sortOrder` (`i + 1`) across the
entire displayed list, sending all items. This both fixes ordering and normalizes
away duplicates on the first click. Apply the same renumber approach to any new
arrow reorder rather than the two-value swap.

**Why a dedicated endpoint, not paired single-row updates:** doing the swap as
two independent update calls is non-atomic — if one succeeds and the other fails,
`sortOrder` values are left duplicated/inconsistent. Every reorder endpoint runs
the swap inside one DB transaction and validates entity ownership + rejects
duplicate ids. When adding reorder to a new builder, add a transactional
`*/reorder` endpoint mirroring `statuses/reorder`; do not swap from the client.

**Records setup-mode column reorder:** table column order == field `sortOrder`,
so left/right column arrows call `reorderFields`. They are gated off when a view
defines a custom `visibleFields` order (`hasCustomColumnOrder`), because swapping
field `sortOrder` would not change a view's explicit column order (a no-op).
