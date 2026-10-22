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
export function filterUserOptionsByRoles(field: Field, options: UserOption[], currentValue?: unknown): UserOption[] {
  // Keep a saved technical identity available for its label only. The combobox
  // never offers it as a choice, and read-only name maps keep historical names.
  const humans = options.filter(u => !u.isServiceAccount || u.id === Number(currentValue));
  const allowed = field.userConfigJson?.allowedRoleIds;
  if (!Array.isArray(allowed) || allowed.length === 0) return humans;
  const allowedSet = new Set(allowed);
  return humans.filter((u) => {
    if (u.isServiceAccount && u.id === Number(currentValue)) return true;
    const userRoles = u.roleIds && u.roleIds.length > 0 ? u.roleIds : [u.roleId];
    return userRoles.some((rid) => allowedSet.has(rid));
  });
}
