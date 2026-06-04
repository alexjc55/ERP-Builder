---
name: RBAC permissions model
description: How role permissions are structured, enforced, and surfaced in the ERP builder
---

# RBAC ("Full" model)

Each role row carries a structured `permissionsJson` (JSONB) shape:
`{ superAdmin: bool, admin: {pages,entities,roles,users,translations: bool}, pageIds: number[], records: {[entityId]: {view,create,update,delete}} }`.

- `superAdmin` bypasses every check. The seeded admin role (id=1) is superAdmin; all other/new roles default to no-access.
- `admin.entities` gates the whole entities builder family: entities + fields + statuses + relations + views mutations (one capability, not per-sub-builder).
- Record CRUD is per-entity; **write implies view** (server and editor both enforce; the roles editor clears writes when view is unchecked).

**Why:** the platform is multi-tenant-style admin-built, so access must be data-driven (rows), not hardcoded.

**How to apply:**
- Backend is the hard boundary. Permissions are loaded **fresh from the DB per request** (not baked into the JWT) so role edits take effect on the next request. Admin mutations → matching `admin.*`; record read/query → `view`, create → `create`, update/delete → `update`/`delete`. Metadata GETs (pages/entities/fields/statuses/relations/views/dashboard) stay auth-only so the shell can render.
- Frontend is cosmetic only (sidebar filter, route NoAccess, hidden buttons) — never the boundary. But still guard content pages by `canPage` at the route level (DynamicPage), not just in the sidebar, or hidden pages are reachable by direct URL.
- `/me` and login responses include the effective `permissions`; the web auth context derives `isSuperAdmin`, `canAdmin(area)`, `canRecord(entityId,action)`, `canPage(pageId)`.
- Admin builder paths map to capabilities via `adminCapForPath()` (`/admin/users`→users, `/roles`→roles, `/pages`→pages, `/translations`→translations, `/entities*`→entities). Keep that map and the route `adminCap` props in sync when adding admin pages.
