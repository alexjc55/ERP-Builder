---
name: Multiple roles per user
description: Users can hold several roles; permissions are the most-permissive union. The boundary rules that must stay consistent across server AND client.
---

# Multiple roles per user

A user has a `users.roleId` (primary) plus a `user_roles` join table (full set). Effective permissions = **most-permissive union** of every assigned role. A single-role user must behave exactly as before.

## The rule that breaks silently if you forget it
Every place that gated something on a *single* role must consider the **full role set** with ANY/most-permissive semantics. The merge engine lives server-side, but the **client mirrors several of these checks** and both must agree, or the UI hides things the server would allow (or vice versa):

- **Field access**: server `resolveFieldAccess(field, perms, roleIds, ...)` and the client `fieldAccess` in `auth.tsx` both resolve explicit per-field perms across ALL roleIds, taking `maxAccess` (edit>view>hidden). All-explicit ⇒ max of explicits; none ⇒ inherited (record create/update ⇒ edit else view); mixed ⇒ max(maxExplicit, inherited). Keep the two implementations in lockstep.
- **Workflow transitions** (`allowedRoleIds`) and **user-type field** `allowedRoleIds`: allowed if the user has ANY listed role. The records-table transition UI must filter with `allowedRoleIds.some(rid => userRoleIds.includes(rid))`, not `includes(user.roleId)`.
- **Impersonation no-escalation guard**: treat the target as superAdmin if ANY of the target's roles is superAdmin (evaluate merged target permissions).

**Why:** a restrictive primary role with a permissive secondary role must not hide pages/fields/statuses/transitions the secondary role grants. Two separate code-review rejections were caused by the UI still using `user.roleId` for transition eligibility and field access after the server merge was already done.

## Write contract (create/update user)
- `roleIds` is the authoritative input: **non-empty, `roleIds[0]` = primary**. The server persists `users.roleId = roleIds[0]` and replaces the `user_roles` set.
- `roleId` is kept in **responses** (JWT/display/impersonation/guest still key off the primary) but is deprecated/ignored on create input. On `UserUpdate` it stays an optional alias because `roleIds` is optional there (a roleId-only update changes just the primary).
- **How to apply:** the admin UI sends `roleIds` with the chosen primary placed first (`[...new Set([primary, ...others])]`). After editing the spec, regenerate Orval/Zod.
