import type { Request } from "express";
import {
  db,
  entityFieldsTable,
  pageFieldsTable,
  pagesTable,
  viewsTable,
  type EntityField,
} from "@workspace/db";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { getPermissions, getUserRoleIds } from "../middlewares/permissions";
import {
  buildPageLocalCondition,
  buildRecordQuery,
  type FilterCondition,
} from "../routes/record-query";
import { buildRelationMeta } from "../routes/own-scope";

const PAGE_FILTER_TYPES = new Set([
  "text", "textarea", "email", "url", "phone", "select", "number", "percent",
  "boolean", "date", "datetime", "user",
]);

type ViewCondition = FilterCondition & { source?: "entity" | "page" };
type ViewConfig = {
  filters?: ViewCondition[];
  filterConjunction?: "and" | "or";
  search?: string;
  viewType?: string;
  pivot?: unknown;
};

type AuthoritativeViewCandidate = Pick<
  typeof viewsTable.$inferSelect,
  "entityId" | "targetPageId" | "isActive" | "visibleRoleIdsJson" | "configJson"
>;

export type AuthoritativeViewResult =
  | { ok: true; view: typeof viewsTable.$inferSelect | null; hardWhere?: SQL }
  | { ok: false; status: 400 | 403 | 404; error: string };

function roleVisible(
  row: Pick<typeof viewsTable.$inferSelect, "visibleRoleIdsJson">,
  roleIds: number[],
  superAdmin: boolean,
): boolean {
  const ids = row.visibleRoleIdsJson;
  return superAdmin || !ids || ids.length === 0 || ids.some((id) => roleIds.includes(id));
}

/** Pure selected-view gate, kept separate so every part of the hard boundary is regression-testable. */
export function isAuthoritativeViewSelectable(
  row: AuthoritativeViewCandidate | null | undefined,
  args: {
    entityId: number;
    pageId?: number;
    roleIds: number[];
    superAdmin: boolean;
    requirePivot?: boolean;
  },
): boolean {
  if (
    !row ||
    row.entityId !== args.entityId ||
    row.targetPageId !== (args.pageId ?? null) ||
    !row.isActive ||
    !roleVisible(row, args.roleIds, args.superAdmin)
  ) {
    return false;
  }
  if (args.requirePivot) {
    const config = (row.configJson ?? {}) as ViewConfig;
    if (config.viewType !== "pivot" || config.pivot == null) return false;
  }
  return true;
}

/** A mirror page cannot omit viewId when it has an applicable assigned view. */
export function mirrorViewSelectionRequired(
  candidates: AuthoritativeViewCandidate[],
  roleIds: number[],
  superAdmin: boolean,
): boolean {
  return candidates.some((row) => row.isActive && roleVisible(row, roleIds, superAdmin));
}

/** A concrete mirror-page context is valid only for roles assigned to that page. */
export function canAccessAuthoritativePage(
  pageId: number | undefined,
  authorizedPageIds: number[],
  superAdmin: boolean,
): boolean {
  return pageId == null || superAdmin || authorizedPageIds.includes(pageId);
}

/** Keep the authoritative group top-level ANDed with all caller/viewer clauses. */
export function combineAuthoritativeAndViewerWhere(
  hardWhere: SQL | undefined,
  viewerWhere: SQL[],
): SQL | undefined {
  const parts = hardWhere ? [hardWhere, ...viewerWhere] : viewerWhere;
  return parts.length > 0 ? and(...parts) : undefined;
}

/**
 * Resolve a caller-selected view as an authoritative row boundary. A page view
 * must match the exact page; a main view must have target_page_id NULL.
 * If a mirror page has any active role-visible assigned view, omitting viewId is
 * rejected so the caller cannot bypass those admin-authored hard conditions.
 */
export async function resolveAuthoritativeView(args: {
  req: Request;
  entityId: number;
  pageId?: number;
  viewId?: number;
  allFields?: EntityField[];
  requirePivot?: boolean;
}): Promise<AuthoritativeViewResult> {
  const { req, entityId, pageId, viewId } = args;
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  if (pageId != null) {
    const [page] = await db.select({ mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable)
      .where(eq(pagesTable.id, pageId)).limit(1);
    if (!page || page.mirrorEntityId !== entityId) {
      return { ok: false, status: 404, error: "Mirror page not found" };
    }
    if (!canAccessAuthoritativePage(pageId, perms.pageIds, perms.superAdmin)) {
      return { ok: false, status: 403, error: "Page access denied" };
    }
  }
  const exactTarget = pageId == null ? isNull(viewsTable.targetPageId) : eq(viewsTable.targetPageId, pageId);

  let view: typeof viewsTable.$inferSelect | null = null;
  if (viewId != null) {
    const [row] = await db.select().from(viewsTable).where(eq(viewsTable.id, viewId)).limit(1);
    if (!isAuthoritativeViewSelectable(row, {
      entityId,
      pageId,
      roleIds,
      superAdmin: perms.superAdmin,
      requirePivot: args.requirePivot,
    })) {
      return { ok: false, status: 404, error: "View not found" };
    }
    view = row!;
  } else if (pageId != null) {
    const candidates = await db.select().from(viewsTable).where(and(
      eq(viewsTable.entityId, entityId),
      exactTarget,
      eq(viewsTable.isActive, true),
    ));
    if (mirrorViewSelectionRequired(candidates, roleIds, perms.superAdmin)) {
      return { ok: false, status: 400, error: "viewId is required for this page" };
    }
  }

  if (!view) return { ok: true, view: null };
  const config = (view.configJson ?? {}) as ViewConfig;
  const conditions = config.filters ?? [];
  const hardParts: SQL[] = [];

  const allFields = args.allFields ?? await db.select().from(entityFieldsTable).where(and(
    eq(entityFieldsTable.entityId, entityId),
    eq(entityFieldsTable.isActive, true),
  ));
  const relationMeta = await buildRelationMeta(entityId, allFields);
  const chunks: SQL[] = [];

  for (const condition of conditions) {
    if ((condition.source ?? "entity") === "entity") {
      const built = buildRecordQuery(allFields, {
        filters: [{ field: condition.field, operator: condition.operator, value: condition.value }],
      }, relationMeta);
      if ("error" in built || !built.where) {
        return { ok: false, status: 400, error: "error" in built ? built.error : "Invalid stored view filter" };
      }
      chunks.push(built.where);
      continue;
    }
    if (pageId == null) {
      return { ok: false, status: 400, error: "Stored page filter has no target page" };
    }
    const [field] = await db.select().from(pageFieldsTable).where(and(
      eq(pageFieldsTable.pageId, pageId),
      eq(pageFieldsTable.fieldKey, condition.field),
      eq(pageFieldsTable.isActive, true),
    )).limit(1);
    if (!field || !PAGE_FILTER_TYPES.has(field.fieldType)) {
      return { ok: false, status: 400, error: `Invalid stored page filter field "${condition.field}"` };
    }
    const built = buildPageLocalCondition(condition, field.fieldType, pageId);
    if ("error" in built) return { ok: false, status: 400, error: built.error };
    chunks.push(built.sql);
  }

  if (chunks.length > 0) {
    const filterGroup = config.filterConjunction === "or" ? or(...chunks) : and(...chunks);
    if (filterGroup) hardParts.push(filterGroup);
  }
  const hardSearch = config.search?.trim();
  if (hardSearch) {
    const built = buildRecordQuery(allFields, { search: hardSearch }, relationMeta);
    if ("error" in built || !built.where) {
      return { ok: false, status: 400, error: "error" in built ? built.error : "Invalid stored view search" };
    }
    hardParts.push(built.where);
  }
  const hardWhere = and(...hardParts);
  return { ok: true, view, hardWhere };
}