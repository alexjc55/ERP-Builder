import type { RoleAdminCaps } from "@workspace/api-client-react";

/**
 * Maps an admin-builder page path to the capability area that gates it.
 * Returns null for non-admin (content) paths.
 */
export function adminCapForPath(path: string): keyof RoleAdminCaps | null {
  if (path.startsWith("/admin/users")) return "users";
  if (path.startsWith("/admin/roles")) return "roles";
  if (path.startsWith("/admin/pages")) return "pages";
  if (path.startsWith("/admin/translations")) return "translations";
  if (path.startsWith("/admin/entities")) return "entities";
  return null;
}
