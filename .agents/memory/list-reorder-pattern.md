---
name: List reorder pattern
description: How sortOrder reordering is done across admin builders, and why it must be a single transactional endpoint.
---

# Arrow-based list reordering

All admin builders with a `sortOrder` (pages, fields, statuses, record views,
workflow transitions) expose up/down arrow reordering. The move helper swaps the
two adjacent siblings' `sortOrder` values and sends them together to a dedicated
`*/reorder` POST endpoint (body `{ entityId, items: [{id, sortOrder}, ...] }`).
Arrows are disabled at list boundaries and while the mutation is pending.

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
