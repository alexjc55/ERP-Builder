---
name: Mirror pages (live read-through of another entity)
description: How a page can show another entity's live records with a field subset, and why mirrorFieldKeys is display-only, not a security boundary.
---

# Mirror pages

A page row can reference an existing entity via `mirrorEntityId` plus an optional
`mirrorFieldKeysJson` (string[] of field keys). The dynamic page renderer then
shows that source entity's **live** records through the normal records path, so
edits are bidirectional (same source records) — never a copy.

**Why a "mirror page" instead of copying records:** the user wanted a live
client-cabinet view of another entity. Reusing the existing records read/write
path means zero risk to the sensitive records flow and automatic bidirectional
sync. Per-client row visibility and field hiding come "for free" from the
EXISTING RBAC on the source entity.

**How to apply / invariants:**
- `mirrorEntityId` has NO FK to entities (avoids a circular pages↔entities import
  in the schema); existence is validated server-side in page create/update
  (400 "Mirror entity not found"). The renderer tolerates a dangling
  mirrorEntityId by showing an empty state.
- Mirror takes priority over a page's bound entity in the renderer.
- `mirrorFieldKeysJson` is a **DISPLAY-ONLY** projection. It narrows which
  columns render; it is NOT a security boundary. Hard field hiding must still be
  done with field-permission "hidden" for the relevant role. `EntityRecords`
  applies the visibleFieldKeys projection first, then still applies field-level
  RBAC hiding on top — the two must not be conflated.
- All records routes and RBAC (record param, effective row scope, field access)
  key off the source entityId, so the mirror inherits them unchanged.
