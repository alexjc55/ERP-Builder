import { db, pagesTable, entitiesTable, entityStatusesTable, entityRecordsTable } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

export type PageStatusScope = NonNullable<typeof pagesTable.$inferSelect.statusScopeJson>;
export const PAGE_SCOPE_PREFIX = "__page_status_scope__:";
export type ScopedRows = { policy: PageStatusScope; base: string[] | null };

export function pageStatusAllowed(policy: PageStatusScope, statusId: number | null) {
  return statusId == null ? policy.includeNoStatus : policy.statusIds.includes(statusId);
}

export function pageStatusWhere(policy: PageStatusScope) {
  const parts = [];
  if (policy.statusIds.length) parts.push(inArray(entityRecordsTable.statusId, policy.statusIds));
  if (policy.includeNoStatus) parts.push(isNull(entityRecordsTable.statusId));
  return parts.length ? or(...parts)! : sql`false`;
}

export function decodePageScope(keys: string[]): ScopedRows | null {
  const key = keys.find(key => key.startsWith(PAGE_SCOPE_PREFIX));
  return key ? JSON.parse(key.slice(PAGE_SCOPE_PREFIX.length)) : null;
}

/** Explicit context must belong to this entity. Main-page context is inferred. */
export async function getPageStatusScope(entityId: number, pageId?: number, executor: Pick<typeof db, "select"> = db): Promise<PageStatusScope | null> {
  const [entity] = await executor.select({ pageId: entitiesTable.pageId }).from(entitiesTable)
    .where(eq(entitiesTable.id, entityId)).limit(1);
  const id = pageId ?? entity?.pageId;
  if (id == null) return null;
  const [page] = await executor.select().from(pagesTable).where(eq(pagesTable.id, id)).limit(1);
  if (!page || (page.mirrorEntityId !== entityId && entity?.pageId !== page.id)) {
    // Invalid page contexts cannot widen a page-scoped read.
    return { statusIds: [], includeNoStatus: false, allowAllChanges: false };
  }
  return page.statusScopeJson;
}

export async function pageStatusChangeAllowed(entityId: number, pageId: number | undefined, statusId: number | null) {
  const policy = await getPageStatusScope(entityId, pageId);
  return !policy || policy.allowAllChanges || pageStatusAllowed(policy, statusId);
}

export async function validatePageStatusScope(policy: PageStatusScope | null | undefined, entityId: number | null | undefined) {
  if (!policy) return null;
  if (entityId == null) return "Status selection requires an entity page";
  const ids = [...new Set(policy.statusIds)];
  if (ids.length) {
    const rows = await db.select({ id: entityStatusesTable.id }).from(entityStatusesTable)
      .where(and(eq(entityStatusesTable.entityId, entityId), inArray(entityStatusesTable.id, ids)));
    if (rows.length !== ids.length) return "Selected statuses must belong to the page entity";
  }
  return null;
}