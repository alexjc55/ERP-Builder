import { db, pagesTable, entitiesTable, entityRecordsTable, entityFieldsTable, type PageField } from "@workspace/db";
import { and, eq, notInArray, or, isNull, type SQL } from "drizzle-orm";
import type { Request } from "express";
import { loadPageRefSource } from "../routes/record-query";
import { effectiveRecordPerm, effectiveScopeFor, getPermissions, getUserRoleIds, mostPermissiveFieldPerm } from "../middlewares/permissions";
import { ownScopeWhere } from "../routes/own-scope";

export const VIEW_PAGE_SCALAR_TYPES = new Set([
  "text", "textarea", "email", "url", "phone", "select", "number", "percent",
  "boolean", "date", "datetime", "user",
]);

/** Resolve metadata only. Runtime authorization is deliberately a separate gate. */
export async function viewPageRefSource(field: PageField, entityId: number) {
  const cfg = field.pageRefConfigJson;
  if (field.fieldType !== "page_ref" || !cfg?.sourcePageId || cfg.sourcePageId === field.pageId) return null;
  const source = await loadPageRefSource(cfg);
  if (!source || !VIEW_PAGE_SCALAR_TYPES.has(source.fieldType)) return null;
  const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, cfg.sourcePageId));
  if (!page) return null;
  const [bound] = await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.pageId, page.id));
  if ((page.mirrorEntityId ?? bound?.id) !== entityId) return null;
  return source;
}

/** Apply outside the OR filter group: inaccessible source rows never become a null value oracle. */
export async function viewPageRefBoundary(req: Request, alias: PageField, source: PageField, entityId: number): Promise<{ allowed: boolean; where?: SQL }> {
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const recordPerm = await effectiveRecordPerm(req, perms, entityId, source.pageId);
  if (!perms.superAdmin && (
    !perms.pageIds.includes(source.pageId) || recordPerm?.view !== true ||
    mostPermissiveFieldPerm(alias.permissionsJson, roleIds, "view", perms, entityId, alias.pageId) === "hidden" ||
    mostPermissiveFieldPerm(source.permissionsJson, roleIds, "view", perms, entityId, source.pageId) === "hidden"
  )) return { allowed: false };
  const clauses: SQL[] = [];
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, source.pageId);
  if (scope === "own") {
    const fields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
    clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
  }
  const hidden = recordPerm?.hiddenRowStatusIds ?? [];
  if (!perms.superAdmin && hidden.length) clauses.push(or(isNull(entityRecordsTable.statusId), notInArray(entityRecordsTable.statusId, hidden))!);
  return { allowed: true, where: and(...clauses) };
}
