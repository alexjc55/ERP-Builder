import { Request, Response, NextFunction } from "express";
import { db, rolesTable, NO_ACCESS_PERMS, type RolePermissions, type RoleAdminCaps, type RecordPermission } from "@workspace/db";
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
