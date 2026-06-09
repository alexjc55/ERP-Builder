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

## Multiple roles per user (most-permissive union)

A user can hold MORE THAN ONE role via a `user_roles` join table (userId+roleId composite PK, FK cascade). `users.roleId` stays the PRIMARY role: it is what the JWT carries, what `roleName` displays, and what impersonation/escalation checks key off. The join table is the full set; the primary is always treated as a member even if a backfill gap drops its row.

Effective permissions = the most-permissive union across ALL of a user's roles, computed fresh per request and merged by `mergePermissions`/`mergeRecordPerms`. A user with exactly one role returns that role's `permissionsJson` UNCHANGED (early `return list[0]`), so single-role behavior is byte-for-byte identical to before.

**Why:** stacking roles must only ever ADD access, never silently weaken a restriction a granting role imposes.

**How to apply:**
- Merge rules: superAdmin / admin caps / CRUD booleans are OR'd; `pageIds` and `scopeFieldKeys` unioned; row `scope` "all" wins over "own"; hidden-status arrays are INTERSECTED (a status stays hidden only if EVERY granting role hides it).
- **Read-boundary gate (critical):** `scope`, `scopeFieldKeys`, and the hidden-status/hidden-row arrays may only be folded from roles where `view === true`. A role that does not grant view must never widen `scope` to "all" or un-hide a status (intersecting its empty hidden list would). A non-granting/empty role must be incapable of relaxing another role's restriction.
- Resolve role ids once per request via `getUserRoleIds(req)` (cached on `req._roleIds`, always includes the JWT primary); never re-query per check. Any code that gated on a single `roleId` (e.g. transition `allowedRoleIds`, widget role visibility, notes-edit) must use ANY-match against the role-id set.
- Auth/guest payloads must include `roleIds` (OpenAPI `User`/`UserProfile` require it). Use `loadRoleContext(userId, primaryRoleId)` — it returns `{ roleIds, permissions }` in one pass so the join table isn't queried twice.
- `resolveFieldAccess` / `mostPermissiveFieldPerm` take `roleIds: number[]` and pick the most-permissive field access (hidden < view < edit) across the set.
- Users CRUD writes `user_roles` transactionally and always keeps the primary in the set. The UI's primary-role Select swaps the OLD primary out of the set (so changing a single-role user's role stays single-role); the additional-roles checkbox list is the rest of the set.

## Per-entity status visibility

`records[entityId]` may carry two sparse arrays: `hiddenStatusIds` (picker/write boundary) and `hiddenRowStatusIds` (row read boundary). Stored sparsely — only OFF exceptions, so new statuses default to visible; absent config = all visible; superAdmin bypasses all.

- **hiddenStatusIds** (`Отображать статус` OFF): status not offered in picker/quick-filter; create rejects an explicit `statusId` in the set; update rejects a status CHANGE into the set (unchanged is fine). A hidden DEFAULT is still allowed as a *system* assignment.
- **hiddenRowStatusIds** (`Отображать строки` OFF): rows whose `statusId` is in the set are excluded from EVERY read path (records list/query/filter-values, GET /records/:id → 404, and ALL page-fields read endpoints: record-values, related-values base+linked, related-candidates). Rows with NULL status are always kept.

**Why:** status visibility must be a hard server boundary, not a cosmetic filter, or a filter/explicit-id probe could surface restricted rows.

**How to apply:**
- Server: `effectiveStatusVisibility(perms, entityId)` (superAdmin → empty) is the source of truth. `hiddenRowStatusWhere(ids)` builds the exclusion SQL; apply it to ANY new endpoint that returns rows of an entity — including ones that take explicit record ids (the base-record set must be filtered too, not just joined/related rows).
- Client (cosmetic mirror only, EntityRecords.tsx): drop hidden-picker statuses from pickers but always keep a record's CURRENT status so its Select renders.
- **Create-default gotcha:** server assigns the default status only when `statusId` is OMITTED (`undefined`); `null` is stored as explicit no-status. When the role's default is hidden the form falls back to NO_STATUS → the create payload must OMIT statusId (see `buildCreateData`) so the server assigns the hidden default, else records are created status-less.
