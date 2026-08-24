import { Router, type IRouter } from "express";
import { db, entitiesTable, entityFieldsTable, entityRecordsTable, pageFieldsTable, pagesTable, usersTable, type FieldPermissions } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  assertRecord,
  effectiveRecordPerm,
  effectiveScopeFor,
  effectiveStatusVisibility,
  getPermissions,
  getUserRoleIds,
  mostPermissiveFieldPerm,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { addStream, initCollaborationBridge, isUnrestrictedVisibilityProfile, putPresence, type Editing } from "../lib/collaboration";
import { isRecordOwned } from "./own-scope";

const router: IRouter = Router();
function validClientId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
function parseEditing(value: unknown): Editing | null | undefined {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  return Number.isInteger(v.entityId) && Number(v.entityId) > 0 && Number.isInteger(v.recordId) && Number(v.recordId) > 0 &&
    typeof v.fieldKey === "string" && v.fieldKey.length > 0 && v.fieldKey.length <= 128 && (v.source === "entity" || v.source === "page")
    ? { entityId: Number(v.entityId), recordId: Number(v.recordId), fieldKey: v.fieldKey, source: v.source } : undefined;
}

type VisibilityProfile = {
  entityId: number | null;
  unrestricted: boolean;
  visibleEntityFieldKeys: Set<string>;
  visiblePageFieldKeys: Set<string>;
  rowScope: Awaited<ReturnType<typeof effectiveScopeFor>>;
  hiddenRowStatusIds: number[];
  entityFields: typeof entityFieldsTable.$inferSelect[];
};

async function visibilityProfile(
  req: Parameters<typeof assertRecord>[0],
  res: Parameters<typeof assertRecord>[1],
  pageId: number,
): Promise<VisibilityProfile | null> {
  const [page] = await db.select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable).where(eq(pagesTable.id, pageId));
  if (!page) { res.status(404).json({ error: "Page not found" }); return null; }
  const [bound] = page.mirrorEntityId == null
    ? await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.pageId, pageId))
    : [];
  const entityId = page.mirrorEntityId ?? bound?.id;
  const perms = await getPermissions(req);
  if (entityId == null) {
    if (!perms.superAdmin && !perms.pageIds.includes(pageId)) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
    return {
      entityId: null,
      unrestricted: true,
      visibleEntityFieldKeys: new Set(),
      visiblePageFieldKeys: new Set(),
      rowScope: { scope: "all", scopeFieldKeys: [] },
      hiddenRowStatusIds: [],
      entityFields: [],
    };
  }
  if (!(await assertRecord(req, res, entityId, "view", pageId))) return null;

  const [entityFields, pageFields, roleIds, rowScope, recordPerm] = await Promise.all([
    db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true))),
    db.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true))),
    getUserRoleIds(req),
    effectiveScopeFor(req, perms, entityId, pageId),
    effectiveRecordPerm(req, perms, entityId, pageId),
  ]);
  const visibleEntityFieldKeys = new Set(entityFields
    .filter((field) => resolveFieldAccess(field, perms, roleIds, entityId, recordPerm, pageId) !== "hidden")
    .map((field) => field.fieldKey));
  const visiblePageFieldKeys = new Set(pageFields
    .filter((field) => perms.superAdmin || perms.admin.pages || mostPermissiveFieldPerm(
      field.permissionsJson as FieldPermissions | null,
      roleIds,
      "view",
      perms,
      entityId,
      pageId,
    ) !== "hidden")
    .map((field) => field.fieldKey));
  const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);
  return {
    entityId,
    unrestricted: isUnrestrictedVisibilityProfile({
      scope: rowScope.scope,
      hiddenRowStatusCount: hiddenRowStatusIds.length,
      visibleEntityFieldCount: visibleEntityFieldKeys.size,
      activeEntityFieldCount: entityFields.length,
      visiblePageFieldCount: visiblePageFieldKeys.size,
      activePageFieldCount: pageFields.length,
    }),
    visibleEntityFieldKeys,
    visiblePageFieldKeys,
    rowScope,
    hiddenRowStatusIds,
    entityFields,
  };
}

router.get("/collaboration/pages/:pageId/stream", requireAuth, async (req, res): Promise<void> => {
  const pageId = Number(req.params.pageId);
  const client = req.query.clientId;
  if (!Number.isInteger(pageId) || !validClientId(client)) { res.status(400).json({ error: "Invalid collaboration stream request" }); return; }
  const profile = await visibilityProfile(req, res, pageId);
  if (!profile) return;
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const close = addStream(pageId, client, res, profile.unrestricted);
  req.on("close", close);
});
router.put("/collaboration/pages/:pageId/presence", requireAuth, async (req, res): Promise<void> => {
  const pageId = Number(req.params.pageId);
  const input = req.body as { clientId?: unknown; editing?: unknown };
  const edit = parseEditing(input?.editing);
  if (!Number.isInteger(pageId) || !validClientId(input?.clientId) || edit === undefined) { res.status(400).json({ error: "Invalid presence request" }); return; }
  const profile = await visibilityProfile(req, res, pageId);
  if (!profile) return;
  let validatedEdit: Editing | null = null;
  if (edit && profile.entityId != null && edit.entityId === profile.entityId) {
    const visibleField = edit.fieldKey === "__status__" ||
      (edit.source === "entity"
        ? profile.visibleEntityFieldKeys.has(edit.fieldKey)
        : profile.visiblePageFieldKeys.has(edit.fieldKey));
    if (visibleField) {
      const [record] = await db.select().from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.id, edit.recordId), eq(entityRecordsTable.entityId, profile.entityId)))
        .limit(1);
      if (record &&
        (record.statusId == null || !profile.hiddenRowStatusIds.includes(record.statusId)) &&
        (profile.rowScope.scope !== "own" ||
          await isRecordOwned(profile.entityId, record, profile.rowScope.scopeFieldKeys, req.user!.userId, profile.entityFields))) {
        validatedEdit = edit;
      }
    }
  }
  const [user] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, req.user!.userId));
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  putPresence(pageId, input.clientId, { id: req.user!.userId, name: `${user.firstName} ${user.lastName}`.trim() }, validatedEdit);
  res.status(204).end();
});
initCollaborationBridge();
export default router;