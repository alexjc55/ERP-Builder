---
name: Column Groups
description: Global column-group definitions + inherited/overridable per-column assignment for the records table; why read access is auth-only.
---

# Column Groups

A GLOBAL, page-independent list of column groups (each: multilingual `nameJson`, `color`,
`displayMode` = `bar` | `fill`, plus `textColor` used by fill). Groups paint the
records-table header: `bar` = thin colored top strip + tooltip; `fill` = filled header
bg + `textColor`. Visible in NORMAL view to every viewer.

## Assignment model: base-on-field + per-page override
- **Base** group lives ON THE FIELD: `entity_fields.columnGroupId` and
  `page_fields.columnGroupId`. Inherited everywhere the field appears, including mirror pages.
- **Override** per page: `pages.columnGroupsJson` is a map `token -> groupId` where the
  token is `e:<fieldKey>` (entity field) or `p:<fieldKey>` (page-local field).
  - token absent → **inherit** the field's base.
  - token = `0` → **force no group** (suppress an inherited base).
  - token = `<id>` → use that group.
- Setup-mode per-header picker: on a NORMAL page it writes the field **base**
  (updateField / updatePageField); on a MIRROR page it writes the **override** into
  `pages.columnGroupsJson` (inherit = delete token, none = 0, value = id).

**Why base-on-field + override:** a column's grouping should follow the field by default
(consistent across the entity's own page and any mirror of it), but a mirror page must be
able to re-skin its own copy without mutating the shared field.

## Read access is AUTH-ONLY (not admin-gated) — deliberate
`GET /column-groups` (list) is `requireAuth` only. Group definitions are pure DISPLAY
metadata, not a security boundary; the header bar/fill must render for EVERY viewer
(non-admins, guests). Mutations (POST/PUT/DELETE) and the `:id` GET stay under
`requireAdmin("columnGroups")`.
**Why:** an earlier cut gated the list behind the `columnGroups` admin cap, so non-admins
got 403/empty and the bar/fill silently disappeared in normal view — violating
"NORMAL view for everyone". If you ever re-tighten this, the visuals break for non-admins.

## Other invariants
- Delete-group is **soft** from the columns' side: pointers are plain ints (no FK), so a
  dangling `columnGroupId` / override just stops rendering.
- `columnGroupId` is per-field config JSONB-adjacent: it must be in BOTH the create insert
  and the PUT updateData allowlist on fields & page-fields, or edits silently no-op
  (see `field-config-json-persistence.md`). `pages.columnGroupsJson` must be in the
  `pages` update allowlist for overrides to persist.
- Gating `canAssignGroup` mirrors server caps: entity field → `entities`, page field /
  mirror override → `pages`.
