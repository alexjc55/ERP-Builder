---
name: user-field-role-filter
description: How a "user" field's role restriction (allowedRoleIds) must match against a user's FULL role set, not just their primary role.
---

# `user` field role restriction must match the full role set

A `user`-type field can restrict its picker to certain roles via `userConfigJson.allowedRoleIds`. Users in this platform hold a **primary role** (`users.roleId`) PLUS any number of **additional roles** (`user_roles` join table). The effective role set is `[roleId, ...user_roles.roleId]`.

**Rule:** any role-based gating/visibility for a user (pickers, "assign to role X" features) must match against the user's FULL role set, not just `roleId`.

**Why:** a user whose primary role is e.g. "Администратор" but who was given "Управляющий проектами" as a secondary role was missing from a user-field picker restricted to "Управляющий проектами", because both the `/users/options` endpoint and the client filter only looked at the primary `roleId`. Additional roles are real grants (RBAC sums permissions across all roles), so they must count here too.

**How to apply:**
- `GET /users/options` returns `roleIds` (deduped `[primary, ...userRoles]`) per option, not just `roleId`. `UserOption` schema carries both (`roleId` kept for back-compat).
- The shared client filter `filterUserOptionsByRoles(field, options)` lives in `lib/userFieldRoles.ts` and intersects `allowedRoleIds` with the user's `roleIds` (falls back to `[roleId]` if `roleIds` absent). Empty/unset `allowedRoleIds` = all users. It is reused by record editors, the records filter bar, AND the view-config filter editor.
- The view-config value picker (`getDomainOptions`) must apply this too: a `user` filter offers the FULL allowed-role domain (not just users present in records), so resolve the field's `allowedRoleIds` and filter — for relation/lookup the config lives on the PROJECTED linked field, so pass that field, not the relation field itself.
- If you add any other "filter users by role" surface, reuse `filterUserOptionsByRoles` — don't reintroduce a primary-only check or a local copy.
