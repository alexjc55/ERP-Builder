import type { Field, UserOption } from "@workspace/api-client-react";

/**
 * Restrict a list of user options to those whose roles satisfy a `user` field's
 * `allowedRoleIds` setting. An empty (or missing) allowedRoleIds means "any role".
 * Matches on the user's FULL role set (primary + additional), so a user who holds
 * the required role as a secondary role still appears.
 *
 * Shared by every surface that offers users for a `user` field (record editors,
 * the records filter bar, and the view-config filter editor) so the role boundary
 * stays consistent — see `.agents/memory/user-field-role-filter.md`.
 */
export function filterUserOptionsByRoles(field: Field, options: UserOption[]): UserOption[] {
  const allowed = field.userConfigJson?.allowedRoleIds;
  if (!Array.isArray(allowed) || allowed.length === 0) return options;
  const allowedSet = new Set(allowed);
  return options.filter((u) => {
    const userRoles = u.roleIds && u.roleIds.length > 0 ? u.roleIds : [u.roleId];
    return userRoles.some((rid) => allowedSet.has(rid));
  });
}
