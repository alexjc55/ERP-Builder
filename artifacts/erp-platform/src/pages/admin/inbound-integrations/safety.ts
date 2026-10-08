import type { RolePermissions } from "@workspace/api-client-react";

export const safeIntegrationRole = (p: RolePermissions | null | undefined) =>
  !!p && !p.superAdmin && !Object.values(p.admin ?? {}).some(Boolean);
export const safeGuestRole = (p: RolePermissions | null | undefined) =>
  safeIntegrationRole(p) &&
  Object.values(p?.records ?? {}).every((r) => !r.create && !r.update && !r.delete);
