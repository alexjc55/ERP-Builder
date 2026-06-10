---
name: Inline create-user-from-field boundary
description: Security rules for creating a user inline from a user-type field (the field's allowCreate option)
---

# Inline "create user from a user-type field"

A user-type field can opt into `userConfigJson.allowCreate`, surfacing an "add new user"
action in its value picker. Creation does NOT go through admin-only `POST /users`
(`requireAdmin("users")`) — that would make the feature usable ONLY by user-admins and
leave the field's role list cosmetic. Instead it has its own endpoint
`POST /fields/:fieldId/users` (`requireAuth` only), open to plain record EDITORS.

Because it is open to non-admins, the endpoint carries its OWN hard boundaries (server-side,
not the UI):
- field must be user-type AND `allowCreate === true`;
- caller must have record `create` OR `update` on the field's entity (via `effectiveRecordPerm`,
  which also honors a mirror-page `pageId` override);
- target role must be within the field's `allowedRoleIds` when that list is non-empty;
- target role must NOT be privileged — `isPrivilegedRole(perms)` = `superAdmin || any admin.* cap`.
  This path can NEVER mint an admin, even if a field is misconfigured to list an admin role.
  Real admin creation always goes through `POST /users`.

**Why:** the field's `allowedRoleIds` (and the UI dropdown filtering) are cosmetic; without the
server checks a record editor could escalate by creating a privileged user from a field.

**How to apply:** keep the privileged-role block and the allowedRoleIds check on the server path,
never rely on the client dropdown. The client (`CreateUserDialog`) mirrors this by filtering
privileged roles out and using `useCreateUserFromField`, but that is convenience only.

Known limitation: the client does not currently send `pageId`, so a caller who has record-edit
rights ONLY via a mirror-page override (not entity-level) could see a false 403. Entity-level
editors (the common case) are unaffected.
