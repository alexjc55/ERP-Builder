import { Request, Response, NextFunction } from "express";
import { db, rolesTable, pagesTable, mirrorPermKey, NO_ACCESS_PERMS, type RolePermissions, type RoleAdminCaps, type RecordPermission, type RecordScope, type EntityField, type FieldAccess, type FieldPermissions } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      permissions?: RolePermissions;
      /** Per-request cache of page id → mirrorEntityId (null = not a mirror / unknown). */
      _pageMirror?: Map<number, number | null>;
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

/** Guard a route to superAdmin only. Use after requireAuth. */
export function requireSuperAdmin() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const perms = await getPermissions(req);
    if (perms.superAdmin) {
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

/** Resolve and cache a page's mirrorEntityId on the request (one DB hit per page per request). */
async function getPageMirrorEntityId(req: Request, pageId: number): Promise<number | null> {
  if (!req._pageMirror) req._pageMirror = new Map();
  const cached = req._pageMirror.get(pageId);
  if (cached !== undefined) return cached;
  const [page] = await db
    .select({ mirrorEntityId: pagesTable.mirrorEntityId })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  const value = page?.mirrorEntityId ?? null;
  req._pageMirror.set(pageId, value);
  return value;
}

/**
 * Resolve the effective record permission for an action, honoring a mirror page
 * override when `pageId` refers to a mirror page of `entityId`. The override is
 * only consulted when BOTH hold: (1) the caller is authorized to that page
 * (`perms.pageIds`), since the override means "actions taken through that mirror
 * page"; and (2) the page genuinely mirrors that entity (validated against the
 * DB). Together these stop a spoofed/foreign `pageId` from escalating or
 * borrowing rights via a page the caller cannot actually use. Returns undefined
 * when neither an override nor an entity-level entry exists (caller treats that
 * as "no access").
 */
export async function effectiveRecordPerm(
  req: Request,
  perms: RolePermissions,
  entityId: number,
  pageId?: number,
): Promise<RecordPermission | undefined> {
  if (pageId != null && (perms.pageIds?.includes(pageId) ?? false)) {
    const mirrorEntityId = await getPageMirrorEntityId(req, pageId);
    if (mirrorEntityId === entityId) {
      const override = perms.records[mirrorPermKey(pageId)];
      if (override) return override;
    }
  }
  return perms.records[String(entityId)];
}

/** Extract an optional mirror-page context id from a request body. */
export function pageIdFromBody(req: Request): number | undefined {
  const value = (req.body as { pageId?: unknown } | undefined)?.pageId;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/**
 * Guard a record route that carries the entity id in `:entityId`.
 * Honors a mirror-page override when the body carries `pageId`. Use after requireAuth.
 */
export function requireRecordParam(action: keyof RecordPermission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const entityId = Number(req.params.entityId);
    if (!Number.isInteger(entityId)) {
      res.status(400).json({ error: "Invalid entity id" });
      return;
    }
    const perms = await getPermissions(req);
    if (perms.superAdmin) {
      next();
      return;
    }
    const rp = await effectiveRecordPerm(req, perms, entityId, pageIdFromBody(req));
    if (rp?.[action] === true) {
      next();
      return;
    }
    res.status(403).json({ error: "Forbidden" });
  };
}

/**
 * Assert a record action for routes keyed by record id (entity resolved from the row).
 * Honors a mirror-page override when `pageId` is supplied. Returns true if
 * allowed; otherwise sends a 403 and returns false.
 */
export async function assertRecord(
  req: Request,
  res: Response,
  entityId: number,
  action: keyof RecordPermission,
  pageId?: number,
): Promise<boolean> {
  const perms = await getPermissions(req);
  if (perms.superAdmin) return true;
  const rp = await effectiveRecordPerm(req, perms, entityId, pageId);
  if (rp?.[action] === true) return true;
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

/**
 * Effective status visibility for the requester on an entity. superAdmin (and
 * roles with no configured exceptions) see every status and every row. Both
 * arrays are SPARSE — they list only the hidden statuses, so statuses added
 * later default to visible.
 * - hiddenStatusIds: not offered in the picker/quick-filter; writes setting a
 *   record to one are rejected.
 * - hiddenRowStatusIds: rows in these statuses are excluded from list/query
 *   results (hard boundary; null-status rows are never excluded).
 */
export function effectiveStatusVisibility(
  perms: RolePermissions,
  entityId: number,
): { hiddenStatusIds: number[]; hiddenRowStatusIds: number[] } {
  if (perms.superAdmin) return { hiddenStatusIds: [], hiddenRowStatusIds: [] };
  const rp = perms.records[String(entityId)];
  const intIds = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];
  return { hiddenStatusIds: intIds(rp?.hiddenStatusIds), hiddenRowStatusIds: intIds(rp?.hiddenRowStatusIds) };
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
export function resolveFieldAccess(
  field: EntityField,
  perms: RolePermissions,
  roleId: number,
  entityId: number,
  rpOverride?: RecordPermission,
): FieldAccess {
  if (perms.superAdmin) return "edit";
  const explicit = (field.permissionsJson as FieldPermissions | undefined)?.[String(roleId)];
  if (explicit) return explicit;
  // When a mirror-page override is supplied it replaces the entity-level record
  // perm for write-derived field access; otherwise fall back to the entity entry.
  const rp = rpOverride ?? perms.records[String(entityId)];
  return rp?.create || rp?.update ? "edit" : "view";
}
