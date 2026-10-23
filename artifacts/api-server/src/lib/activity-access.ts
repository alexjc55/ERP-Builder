import type { Request } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import { db, entitiesTable, entityRecordsTable, entityFieldsTable, pagesTable, usersTable, aiAgentsTable, inboundIntegrationsTable, activitySettingsTable } from "@workspace/db";
import { getPermissions, freshPermissions, effectiveRecordPerm, effectiveScopeFor, effectiveStatusVisibility, resolveFieldAccess, getUserRoleIds } from "../middlewares/permissions";
import { isRecordOwned } from "../routes/own-scope";

export type ActivityReader = Pick<typeof db, "select">;
export class ActivityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function activityEnabled(entityId: number, reader: ActivityReader = db) {
  const [setting] = await reader.select().from(activitySettingsTable).where(eq(activitySettingsTable.entityId, entityId));
  return setting?.enabled === true;
}
export const humanUserWhere = sql`${usersTable.isActive} = true
  AND NOT EXISTS (SELECT 1 FROM ${aiAgentsTable} WHERE ${aiAgentsTable.userId} = ${usersTable.id})
  AND NOT EXISTS (SELECT 1 FROM ${inboundIntegrationsTable} WHERE ${inboundIntegrationsTable.userId} = ${usersTable.id})
  AND ${usersTable.email} !~* '^(inbound-[0-9a-f]+@integrations[.]local|ai-agent-[0-9a-f]+@agents[.]local)$'`;

/** A real record boundary, including mirror overrides, row filters and status hiding.
 * Omitted page means find an authorized surface; explicit page may never fall back. */
export async function activityAccess(req: Request, entityId: number, recordId: number, pageId?: number | null, reader: ActivityReader = db) {
  const [entity] = await reader.select().from(entitiesTable).where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.isActive, true)));
  const [record] = await reader.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.entityId, entityId)));
  if (!entity || !record || !req.user) return null;
  const perms = reader === db ? await getPermissions(req) : await freshPermissions(req, reader);
  const hidden = effectiveStatusVisibility(perms, entityId).hiddenRowStatusIds;
  if (record.statusId != null && hidden.includes(record.statusId)) return null;
  const pages = await reader.select().from(pagesTable).where(and(eq(pagesTable.isActive, true),
    or(eq(pagesTable.mirrorEntityId, entityId), eq(pagesTable.id, entity.pageId ?? -1))));
  const allowed = pages.filter(p => perms.superAdmin || perms.pageIds.includes(p.id));
  if (pageId != null && !allowed.some(p => p.id === pageId)) return null;
  const contexts: (number | undefined)[] = pageId != null ? [pageId] : [...allowed.map(p => p.id), undefined];
  const fields = await reader.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  for (const context of contexts) {
    const rp = await effectiveRecordPerm(req, perms, entityId, context, reader);
    if (!perms.superAdmin && !rp?.view) continue;
    const scope = await effectiveScopeFor(req, perms, entityId, context, reader);
    if (scope.scope !== "all" && !await isRecordOwned(entityId, record, scope.scopeFieldKeys, req.user.userId, fields, reader)) continue;
    const roles = await getUserRoleIds(req);
    // Only use a visible scalar field for the human-readable record heading.
    const labelField = fields.find(f => ["text", "textarea"].includes(f.fieldType) && resolveFieldAccess(f, perms, roles, entityId, rp, context) !== "hidden");
    const rawLabel = labelField ? (record.valuesJson as Record<string, unknown>)?.[labelField.fieldKey] : undefined;
    const entityLabel = entity.nameJson as Record<string, string>;
    const recordLabel = `${entityLabel.ru || entityLabel.en || entityLabel.he || "Запись"} #${record.id}${typeof rawLabel === "string" && rawLabel ? ` — ${rawLabel.slice(0, 200)}` : ""}`;
    const page = allowed.find(p => p.id === context);
    const recordUrl = page?.path && page.path.startsWith("/") && !page.path.startsWith("//")
      ? `${page.path}?recordId=${record.id}` : null;
    return { record, entity, perms, fields, pageId: context ?? null, recordLabel, recordUrl,
      canWrite: !req.user.guest && !record.archivedAt && (perms.superAdmin || rp?.update === true) };
  }
  return null;
}

export async function activityUserRequest(userId: number, reader: ActivityReader = db): Promise<Request | null> {
  const [user] = await reader.select().from(usersTable).where(and(eq(usersTable.id, userId), humanUserWhere));
  if (!user) return null;
  return { user: { userId: user.id, roleId: user.roleId } } as Request;
}

export async function eligibleAssignee(userId: number, entityId: number, recordId: number, pageId?: number | null, reader: ActivityReader = db) {
  const req = await activityUserRequest(userId, reader);
  if (!req) return null;
  return activityAccess(req, entityId, recordId, pageId, reader);
}
