import { Request, Response, NextFunction } from "express";
import { db, rolesTable, NO_ACCESS_PERMS, type RolePermissions, type RoleAdminCaps, type RecordPermission, type RecordScope, type EntityField, type FieldAccess, type FieldPermissions } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      permissions?: RolePermissions;
    }
  }
}

/** Load a role's effective permissions from the DB (fresh per request). */
export async function loadPermissions(roleId: number): Promise<RolePermissions> {
  const [role] = await db
    .select({ permissionsJson: rolesTable.permissionsJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, roleId))
    .limit(1);
  return role?.permissionsJson ?? NO_ACCESS_PERMS;
}

/**
 * Resolve and cache the requesting user's permissions on the request object.
 * Returns NO_ACCESS for unauthenticated requests (should be preceded by requireAuth).
 */
export async function getPermissions(req: Request): Promise<RolePermissions> {
  if (req.permissions) return req.permissions;
  if (!req.user) return NO_ACCESS_PERMS;
  const perms = await loadPermissions(req.user.roleId);
  req.permissions = perms;
  return perms;
}

/** Guard an admin-builder mutation by capability area. Use after requireAuth. */
export function requireAdmin(area: keyof RoleAdminCaps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const perms = await getPermissions(req);
    if (perms.superAdmin || perms.admin[area]) {
      next();
      return;
    }
    res.status(403).json({ error: "Forbidden" });
  };
}

/** True if the permissions grant the given record action for the entity. */
export function canRecord(perms: RolePermissions, entityId: number, action: keyof RecordPermission): boolean {
  if (perms.superAdmin) return true;
  return perms.records[String(entityId)]?.[action] === true;
}

/**
 * Guard a record route that carries the entity id in `:entityId`.
 * Use after requireAuth.
 */
export function requireRecordParam(action: keyof RecordPermission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const entityId = Number(req.params.entityId);
    if (!Number.isInteger(entityId)) {
      res.status(400).json({ error: "Invalid entity id" });
      return;
    }
    const perms = await getPermissions(req);
    if (canRecord(perms, entityId, action)) {
      next();
      return;
    }
    res.status(403).json({ error: "Forbidden" });
  };
}

/**
 * Assert a record action for routes keyed by record id (entity resolved from the row).
 * Returns true if allowed; otherwise sends a 403 and returns false.
 */
export async function assertRecord(req: Request, res: Response, entityId: number, action: keyof RecordPermission): Promise<boolean> {
  const perms = await getPermissions(req);
  if (canRecord(perms, entityId, action)) return true;
  res.status(403).json({ error: "Forbidden" });
  return false;
}

/**
 * Effective row scope for the requester on an entity. superAdmin and roles
 * without an explicit "own" scope see all rows. "own" restricts visibility to
 * rows owned via one of `scopeFieldKeys` (user-type fields).
 */
export function effectiveScope(perms: RolePermissions, entityId: number): { scope: RecordScope; scopeFieldKeys: string[] } {
  if (perms.superAdmin) return { scope: "all", scopeFieldKeys: [] };
  const rp = perms.records[String(entityId)];
  return { scope: rp?.scope === "own" ? "own" : "all", scopeFieldKeys: rp?.scopeFieldKeys ?? [] };
}

/** True if the record (its values) is owned by `userId` via any scope field key. */
export function recordOwnedBy(values: Record<string, unknown>, scopeFieldKeys: string[], userId: number): boolean {
  return scopeFieldKeys.some((k) => Number(values[k]) === userId);
}

/**
 * Resolve a field's access level for the requesting role.
 * superAdmin always edits. An explicit per-field entry wins; otherwise the
 * field inherits from the role's record write perms (create OR update => edit,
 * else view) so existing fields without explicit perms behave exactly as before:
 * a create-only role can still populate fields on create, and an update-only role
 * can edit on update (each write endpoint stays gated by its own record perm).
 */
export function resolveFieldAccess(field: EntityField, perms: RolePermissions, roleId: number, entityId: number): FieldAccess {
  if (perms.superAdmin) return "edit";
  const explicit = (field.permissionsJson as FieldPermissions | undefined)?.[String(roleId)];
  if (explicit) return explicit;
  const rp = perms.records[String(entityId)];
  return rp?.create || rp?.update ? "edit" : "view";
}
