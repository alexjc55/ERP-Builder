import { Request, Response, NextFunction } from "express";
import { db, rolesTable, userRolesTable, pagesTable, mirrorPermKey, NO_ACCESS_PERMS, type RolePermissions, type RoleAdminCaps, type RecordPermission, type RecordScope, type EntityField, type FieldAccess, type FieldPermissions } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      permissions?: RolePermissions;
      /** Per-request cache of the requester's full set of role ids (primary + extras). */
      _roleIds?: number[];
      /** Per-request cache of page id → mirrorEntityId (null = not a mirror / unknown). */
      _pageMirror?: Map<number, number | null>;
    }
  }
}

/** Order field-access levels by permissiveness so we can take the maximum. */
const ACCESS_RANK: Record<FieldAccess, number> = { hidden: 0, view: 1, edit: 2 };

/** Return the more permissive of two field-access levels (edit > view > hidden). */
export function maxAccess(a: FieldAccess | null, b: FieldAccess): FieldAccess {
  if (a === null) return b;
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

const intIds = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];

/** Intersection of two integer-id arrays (preserves order of the first). */
function intersectIds(a: number[], b: number[]): number[] {
  const set = new Set(b);
  return a.filter((n) => set.has(n));
}

/**
 * Merge several roles' record-permission entries for a SINGLE entity (or mirror
 * key) into one most-permissive entry. CRUD booleans are OR'd; row scope "all"
 * wins over "own"; scopeFieldKeys are unioned; hidden status arrays are
 * INTERSECTED across the granting roles (a status stays hidden only if EVERY
 * granting role hides it — so any role that can see it makes it visible).
 */
function mergeRecordPerms(rps: RecordPermission[]): RecordPermission {
  const out: RecordPermission = { view: false, create: false, update: false, delete: false };
  let anyAllScope = false;
  const scopeKeys = new Set<string>();
  let hiddenStatus: number[] | null = null;
  let hiddenRow: number[] | null = null;
  // Cosmetic column hides are restrictions: a column stays hidden only if EVERY
  // view-granting role hides it (AND), so stacking a role that shows the column
  // re-reveals it. null = no view-granting role seen yet.
  let hideStatusCol: boolean | null = null;
  let hideActionsCol: boolean | null = null;
  for (const rp of rps) {
    out.view ||= rp.view === true;
    out.create ||= rp.create === true;
    out.update ||= rp.update === true;
    out.delete ||= rp.delete === true;
  }
  // Row scope and hidden-status lists are READ boundaries: only roles that
  // actually grant `view` may relax them. A role that does not grant view must
  // never widen row visibility to "all" or un-hide a status (which intersecting
  // its empty hidden list would do), so it cannot weaken another role's
  // restriction. If no role grants view there is nothing to read anyway.
  for (const rp of rps) {
    if (rp.view !== true) continue;
    // Missing/`"all"` scope means full visibility for that role.
    if (rp.scope !== "own") anyAllScope = true;
    for (const k of rp.scopeFieldKeys ?? []) scopeKeys.add(k);
    const hs = intIds(rp.hiddenStatusIds);
    hiddenStatus = hiddenStatus === null ? hs : intersectIds(hiddenStatus, hs);
    const hr = intIds(rp.hiddenRowStatusIds);
    hiddenRow = hiddenRow === null ? hr : intersectIds(hiddenRow, hr);
    const hsc = rp.hideStatusColumn === true;
    hideStatusCol = hideStatusCol === null ? hsc : hideStatusCol && hsc;
    const hac = rp.hideActionsColumn === true;
    hideActionsCol = hideActionsCol === null ? hac : hideActionsCol && hac;
  }
  out.scope = anyAllScope ? "all" : "own";
  if (out.scope === "own" && scopeKeys.size > 0) out.scopeFieldKeys = [...scopeKeys];
  if (hiddenStatus && hiddenStatus.length > 0) out.hiddenStatusIds = hiddenStatus;
  if (hiddenRow && hiddenRow.length > 0) out.hiddenRowStatusIds = hiddenRow;
  if (hideStatusCol) out.hideStatusColumn = true;
  if (hideActionsCol) out.hideActionsColumn = true;
  return out;
}

/**
 * Merge a set of roles' permissions into one most-permissive RolePermissions.
 * superAdmin / admin caps are OR'd, pageIds unioned, and each record key is
 * merged via {@link mergeRecordPerms}. A single role is returned unchanged so
 * single-role behavior is byte-for-byte identical to before multi-role support.
 */
export function mergePermissions(list: RolePermissions[]): RolePermissions {
  if (list.length === 0) return NO_ACCESS_PERMS;
  if (list.length === 1) return list[0];
  const admin: RoleAdminCaps = {
    pages: false, entities: false, roles: false, users: false, translations: false,
    events: false, modules: false, googleDrive: false, settings: false, automations: false,
  };
  const merged: RolePermissions = { superAdmin: false, admin, pageIds: [], records: {} };
  const pageIdSet = new Set<number>();
  for (const p of list) {
    if (p.superAdmin) merged.superAdmin = true;
    if (p.admin) {
      for (const k of Object.keys(admin) as (keyof RoleAdminCaps)[]) {
        if (p.admin[k]) admin[k] = true;
      }
    }
    for (const id of p.pageIds ?? []) pageIdSet.add(id);
  }
  merged.pageIds = [...pageIdSet];
  const keys = new Set<string>();
  for (const p of list) for (const k of Object.keys(p.records ?? {})) keys.add(k);
  for (const key of keys) {
    const rps = list
      .map((p) => p.records?.[key])
      .filter((rp): rp is RecordPermission => rp != null);
    merged.records[key] = mergeRecordPerms(rps);
  }
  return merged;
}

/** Load the permission specs for a set of role ids (order not guaranteed). */
export async function loadPermissionsForRoles(roleIds: number[]): Promise<RolePermissions[]> {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ permissionsJson: rolesTable.permissionsJson })
    .from(rolesTable)
    .where(inArray(rolesTable.id, ids));
  return rows.map((r) => r.permissionsJson ?? NO_ACCESS_PERMS);
}

/** Load a single role's effective permissions from the DB (fresh per request). */
export async function loadPermissions(roleId: number): Promise<RolePermissions> {
  const [role] = await db
    .select({ permissionsJson: rolesTable.permissionsJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, roleId))
    .limit(1);
  return role?.permissionsJson ?? NO_ACCESS_PERMS;
}

/** All role ids assigned to a user (from the join table), excluding duplicates. */
export async function loadUserRoleIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  return rows.map((r) => r.roleId);
}

/**
 * Effective merged permissions for a user, by id. Loads ALL of the user's roles
 * (always including the primary `roleId` as a safety net for any backfill gap)
 * and merges them most-permissively. Used by auth/guest flows that build the
 * client-facing `permissions` payload outside of a request context.
 */
export async function loadPermissionsForUser(userId: number, primaryRoleId: number): Promise<RolePermissions> {
  return (await loadRoleContext(userId, primaryRoleId)).permissions;
}

/**
 * Like {@link loadPermissionsForUser} but also returns the resolved role id set
 * (primary first) in a single pass. Auth/guest payloads need both the merged
 * permissions and `roleIds` for the client-facing user object, so this avoids
 * querying the join table twice.
 */
export async function loadRoleContext(
  userId: number,
  primaryRoleId: number,
): Promise<{ roleIds: number[]; permissions: RolePermissions }> {
  let ids = await loadUserRoleIds(userId);
  if (!ids.includes(primaryRoleId)) ids = [primaryRoleId, ...ids];
  if (ids.length === 0) ids = [primaryRoleId];
  ids = [...new Set(ids)];
  return { roleIds: ids, permissions: mergePermissions(await loadPermissionsForRoles(ids)) };
}

/**
 * Resolve and cache the requester's full set of role ids on the request. Always
 * includes the JWT's primary `roleId` so a missing join-table backfill can never
 * silently drop access. Returns [] only for unauthenticated requests.
 */
export async function getUserRoleIds(req: Request): Promise<number[]> {
  if (req._roleIds) return req._roleIds;
  if (!req.user) return [];
  let ids = await loadUserRoleIds(req.user.userId);
  if (!ids.includes(req.user.roleId)) ids = [req.user.roleId, ...ids];
  if (ids.length === 0) ids = [req.user.roleId];
  req._roleIds = ids;
  return ids;
}

/**
 * Resolve and cache the requesting user's permissions on the request object.
 * Loads and merges ALL of the user's roles (most-permissive union). Returns
 * NO_ACCESS for unauthenticated requests (should be preceded by requireAuth).
 */
export async function getPermissions(req: Request): Promise<RolePermissions> {
  if (req.permissions) return req.permissions;
  if (!req.user) return NO_ACCESS_PERMS;
  const roleIds = await getUserRoleIds(req);
  const perms = mergePermissions(await loadPermissionsForRoles(roleIds));
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

/**
 * True if a role carries ANY privileged capability — `superAdmin` or any
 * `admin.*` capability. Privileged roles can never be assigned to a user created
 * through the inline "create user from a field" path: that path is open to plain
 * record editors (no `users` admin cap), so allowing a privileged target role
 * would be a privilege-escalation hole even if a field were misconfigured to
 * list one. This is a HARD server boundary, mirrored cosmetically in the UI.
 */
export function isPrivilegedRole(perms: RolePermissions): boolean {
  return perms.superAdmin === true || Object.values(perms.admin).some(Boolean);
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
 *
 * `opts.entityOnly` forces an ENTITY-LEVEL gate that ignores any body `pageId`.
 * It MUST be set on routes whose handler resolves row scope and field visibility
 * at the entity level (the sync `effectiveScope`, no pageId) — e.g. the
 * entity-direct list. Otherwise a mirror-only role could pass the page-aware CRUD
 * gate with a spoofed body `pageId` and then be served entity-level scope/fields
 * (a confused-deputy widening). Mirror reads go through the page-aware POST
 * endpoints instead. Keep gate page-awareness in lockstep with scope/field
 * page-awareness on every route.
 */
export function requireRecordParam(action: keyof RecordPermission, opts?: { entityOnly?: boolean }) {
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
    const pageId = opts?.entityOnly ? undefined : pageIdFromBody(req);
    const rp = await effectiveRecordPerm(req, perms, entityId, pageId);
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
 * Page-aware effective row scope, paralleling {@link effectiveRecordPerm}. When
 * `pageId` refers to an AUTHORIZED mirror page of `entityId` (caller is in
 * `perms.pageIds` AND the page genuinely mirrors the entity per the DB) and a
 * `mirror:<pageId>` override exists, the row scope is taken ENTIRELY from that
 * override — fully replacing the entity-level scope, exactly as the override
 * replaces the entity's CRUD rights for actions through that page. A missing
 * `scope` on the override means "all" (the override's own default), so enabling
 * an override never silently inherits a narrower entity scope. Otherwise this
 * falls back to the entity-level {@link effectiveScope}. Use ONLY on paths that
 * resolve CRUD page-aware (carry `pageId`); entity-level paths must keep using
 * the sync `effectiveScope`, so scope page-awareness tracks CRUD page-awareness.
 */
export async function effectiveScopeFor(
  req: Request,
  perms: RolePermissions,
  entityId: number,
  pageId?: number,
): Promise<{ scope: RecordScope; scopeFieldKeys: string[] }> {
  if (perms.superAdmin) return { scope: "all", scopeFieldKeys: [] };
  if (pageId != null && (perms.pageIds?.includes(pageId) ?? false)) {
    const mirrorEntityId = await getPageMirrorEntityId(req, pageId);
    if (mirrorEntityId === entityId) {
      const override = perms.records[mirrorPermKey(pageId)];
      if (override) {
        return {
          scope: override.scope === "own" ? "own" : "all",
          scopeFieldKeys: override.scopeFieldKeys ?? [],
        };
      }
    }
  }
  return effectiveScope(perms, entityId);
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
  return { hiddenStatusIds: intIds(rp?.hiddenStatusIds), hiddenRowStatusIds: intIds(rp?.hiddenRowStatusIds) };
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
  roleIds: number[],
  entityId: number,
  rpOverride?: RecordPermission,
): FieldAccess {
  if (perms.superAdmin) return "edit";
  // When a mirror-page override is supplied it replaces the entity-level record
  // perm for write-derived field access; otherwise fall back to the entity entry.
  const rp = rpOverride ?? perms.records[String(entityId)];
  const inherited: FieldAccess = rp?.create || rp?.update ? "edit" : "view";
  const permsJson = field.permissionsJson as FieldPermissions | undefined;
  const explicits = roleIds
    .map((rid) => permsJson?.[String(rid)])
    .filter((v): v is FieldAccess => v != null);
  // Single-role / all-roles-explicit: explicit governs (most permissive among
  // them) — preserves the original "explicit wins, even hidden" behavior.
  if (roleIds.length > 0 && explicits.length === roleIds.length) {
    return explicits.reduce<FieldAccess | null>((acc, v) => maxAccess(acc, v), null) ?? inherited;
  }
  // No role has an explicit entry → inherit from (merged) record write perms.
  if (explicits.length === 0) return inherited;
  // Mixed: some roles explicit, others inherit → take the most permissive.
  const maxExplicit = explicits.reduce<FieldAccess | null>((acc, v) => maxAccess(acc, v), null);
  return maxAccess(maxExplicit, inherited);
}

/**
 * Most-permissive access level for a generic field-permission map (e.g. page
 * fields, which default to `fallback` when a role has no explicit entry) across
 * all of a user's roles. With a single role this equals the legacy
 * `permsJson?.[roleId] ?? fallback` lookup.
 */
export function mostPermissiveFieldPerm(
  permsJson: FieldPermissions | null | undefined,
  roleIds: number[],
  fallback: FieldAccess,
): FieldAccess {
  let best: FieldAccess | null = null;
  let anyMissing = false;
  for (const rid of roleIds) {
    const v = permsJson?.[String(rid)];
    if (v) best = maxAccess(best, v);
    else anyMissing = true;
  }
  if (best === null) return fallback;
  // Roles without an explicit entry contribute the fallback level.
  return anyMissing ? maxAccess(best, fallback) : best;
}
