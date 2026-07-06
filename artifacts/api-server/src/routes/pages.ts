import { Router, type IRouter } from "express";
import {
  db,
  pagesTable,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  pageFieldsTable,
  viewsTable,
} from "@workspace/db";
import { eq, isNull, asc, and, inArray, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, getPermissions } from "../middlewares/permissions";
import { buildRelationMeta } from "./own-scope";
import { computePivot, type PivotConfigInput } from "./pivot-compute";
import { buildRecordQuery, type RecordQuerySpec, type FilterCondition } from "./record-query";
import {
  CreatePageBody,
  UpdatePageBody,
  GetPageParams,
  UpdatePageParams,
  DeletePageParams,
  ReorderPagesBody,
  GetPivotPageDataParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildTree(pages: typeof pagesTable.$inferSelect[]): unknown[] {
  const map = new Map<number, unknown>();
  const roots: unknown[] = [];

  for (const page of pages) {
    map.set(page.id, { ...page, children: [] });
  }

  for (const page of pages) {
    const node = map.get(page.id) as { children: unknown[] };
    if (page.parentPageId && map.has(page.parentPageId)) {
      const parent = map.get(page.parentPageId) as { children: unknown[] };
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

router.get("/pages", requireAuth, async (_req, res): Promise<void> => {
  const pages = await db
    .select()
    .from(pagesTable)
    .orderBy(asc(pagesTable.sortOrder));

  res.json(pages);
});

router.post("/pages/reorder", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const parsed = ReorderPagesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx
        .update(pagesTable)
        .set({ sortOrder: item.sortOrder })
        .where(eq(pagesTable.id, item.id));
    }
  });

  res.json({ success: true, message: "Reordered" });
});

/** An empty pivot result, returned when a pivot page has no usable config. */
function emptyPivotResult() {
  return {
    rows: [],
    cols: [],
    cells: [],
    rowTotals: [],
    colTotals: [],
    grandTotal: 0,
    measureLabel: "",
  };
}

/** True if the entity exists (used to validate a page's mirror target). */
async function entityExists(entityId: number): Promise<boolean> {
  const [e] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  return Boolean(e);
}

/**
 * Validates a mirror-page groupByFieldKey against the mirror entity's ACTIVE
 * fields. Returns an error message, or null when the key is usable. Allowed:
 * any stored scalar field, or a relation/lookup field that resolves to a
 * single-link direction (grouping by the linked record). Rejected: function
 * (not stored) and file (no meaningful group key) fields, unknown keys, and
 * multi-link relations.
 */
async function validateGroupByField(mirrorEntityId: number, fieldKey: string): Promise<string | null> {
  const fields = await db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, mirrorEntityId), eq(entityFieldsTable.isActive, true)));
  const f = fields.find((x) => x.fieldKey === fieldKey);
  if (!f) return "Group field not found on the mirrored entity";
  if (f.fieldType === "function" || f.fieldType === "file") {
    return "This field type cannot be used for grouping";
  }
  if (f.fieldType === "relation" || f.fieldType === "lookup") {
    const meta = await buildRelationMeta(mirrorEntityId, [f]);
    if (!meta.get(fieldKey)) return "Only single-link relation fields can be used for grouping";
  }
  return null;
}

/** True if some entity is bound to this page (entities.page_id === pageId). */
async function pageHasBoundEntity(pageId: number): Promise<boolean> {
  const [e] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.pageId, pageId))
    .limit(1);
  return Boolean(e);
}

router.post("/pages", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const parsed = CreatePageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.mirrorEntityId != null && !(await entityExists(parsed.data.mirrorEntityId))) {
    res.status(400).json({ error: "Mirror entity not found" });
    return;
  }

  if (parsed.data.isDashboard && parsed.data.mirrorEntityId != null) {
    res.status(400).json({ error: "A dashboard page cannot also mirror an entity" });
    return;
  }

  // Pivot pages: validate the reported-on entity exists and enforce the
  // pivot ⊥ dashboard ⊥ mirror exclusivity (a bound entity is impossible on a
  // freshly created page, so it is only checked on update).
  if (parsed.data.isPivot) {
    if (parsed.data.pivotEntityId == null) {
      res.status(400).json({ error: "A pivot page requires a target entity" });
      return;
    }
    if (!(await entityExists(parsed.data.pivotEntityId))) {
      res.status(400).json({ error: "Pivot entity not found" });
      return;
    }
    if (parsed.data.mirrorEntityId != null) {
      res.status(400).json({ error: "A pivot page cannot also mirror an entity" });
      return;
    }
    if (parsed.data.isDashboard) {
      res.status(400).json({ error: "A pivot page cannot also be a dashboard" });
      return;
    }
  }

  // Grouping is a mirror-page-only setting and must point at a usable field
  // of the mirrored entity.
  const createGroupBy = parsed.data.groupByFieldKey || null;
  if (createGroupBy != null) {
    if (parsed.data.mirrorEntityId == null) {
      res.status(400).json({ error: "Grouping is only available on mirror pages" });
      return;
    }
    const gErr = await validateGroupByField(parsed.data.mirrorEntityId, createGroupBy);
    if (gErr) {
      res.status(400).json({ error: gErr });
      return;
    }
  }

  const [page] = await db
    .insert(pagesTable)
    .values({ ...parsed.data, groupByFieldKey: createGroupBy })
    .returning();
  res.status(201).json({ ...page, children: [] });
});

router.get("/pages/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [page] = await db
    .select()
    .from(pagesTable)
    .where(eq(pagesTable.id, params.data.id));

  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json({ ...page, children: [] });
});

// GET /pages/:id/pivot/data — the computed cross-tab for a PIVOT PAGE.
// ADMIN-AUTHORITATIVE: like dashboard widgets, the totals are the real aggregates
// over ALL the entity's non-archived records (matching the page's configured
// filters), independent of the viewer's row/field data permissions. Access is
// governed solely by the caller's per-role PAGE access (no per-page role list).
router.get("/pages/:id/pivot/data", requireAuth, async (req, res): Promise<void> => {
  const params = GetPivotPageDataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const pageId = params.data.id;

  const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, pageId));
  if (!page || !page.isPivot) {
    res.status(404).json({ error: "Pivot page not found" });
    return;
  }

  // Per-role page access is the boundary (reuse the same gate as the sidebar /
  // dashboard data). superAdmin always passes.
  const perms = await getPermissions(req);
  if (!perms.superAdmin && !perms.pageIds.includes(pageId)) {
    res.status(403).json({ error: "Нет доступа к этой странице" });
    return;
  }

  const entityId = page.pivotEntityId;
  if (entityId == null) {
    res.status(400).json({ error: "Pivot page has no target entity" });
    return;
  }
  const [entity] = await db
    .select({
      pivotEnabled: entitiesTable.pivotEnabled,
      defaultPivotJson: entitiesTable.defaultPivotJson,
      isActive: entitiesTable.isActive,
    })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId));
  // Re-check the entity's pivot opt-in at compute time (mirrors computePivotWidget):
  // if pivot mode is later disabled (or the entity removed/deactivated), the page
  // degrades to an empty result rather than erroring.
  if (!entity || !entity.isActive || !entity.pivotEnabled) {
    res.json(emptyPivotResult());
    return;
  }

  // Resolve the effective PivotConfig from the configured source.
  const cfg = (page.pivotConfigJson ?? { source: "entity" }) as {
    source?: "entity" | "view" | "custom";
    viewId?: number | null;
    pivot?: unknown;
    pageId?: number | null;
    filters?: FilterCondition[];
    filterConjunction?: "and" | "or";
    statusIds?: number[];
    search?: string | null;
  };
  let pivot: PivotConfigInput | null = null;
  if (cfg.source === "custom") {
    pivot = (cfg.pivot ?? null) as PivotConfigInput | null;
  } else if (cfg.source === "view" && cfg.viewId != null) {
    const [view] = await db
      .select({ entityId: viewsTable.entityId, configJson: viewsTable.configJson })
      .from(viewsTable)
      .where(eq(viewsTable.id, cfg.viewId))
      .limit(1);
    const vc = view?.configJson as { viewType?: string; pivot?: unknown } | null | undefined;
    if (view && view.entityId === entityId && vc?.viewType === "pivot" && vc.pivot != null) {
      pivot = vc.pivot as PivotConfigInput;
    }
  } else {
    // source === "entity" (default)
    pivot = (entity.defaultPivotJson ?? null) as PivotConfigInput | null;
  }
  if (!pivot || !pivot.rows) {
    res.json(emptyPivotResult());
    return;
  }

  // ALL active fields → admin-authoritative (no hidden-field exclusion). The page
  // filters are applied over this full set; statusIds + non-archived bound the rows.
  const fields = await db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const relationMeta = await buildRelationMeta(entityId, fields);

  const spec: RecordQuerySpec = {
    filters: cfg.filters ?? [],
    filterConjunction: cfg.filterConjunction,
    search: cfg.search ?? undefined,
  };
  const built = buildRecordQuery(fields, spec, relationMeta);
  if ("error" in built) {
    res.status(400).json({ error: built.error });
    return;
  }

  const clauses: SQL[] = [
    eq(entityRecordsTable.entityId, entityId),
    isNull(entityRecordsTable.archivedAt),
  ];
  if (built.where) clauses.push(built.where);
  const statusIds = (cfg.statusIds ?? []).filter((n) => Number.isInteger(n));
  if (statusIds.length > 0) clauses.push(inArray(entityRecordsTable.statusId, statusIds));

  // Page context for page-local (source=page) dims/measures in a CUSTOM config:
  // re-check at compute time that the context page still belongs to this entity
  // (bound page or mirror page); on mismatch skip it — a config that references
  // page fields then degrades to the empty result inside computePivot.
  let pageFields: { fieldKey: string; pivotEnabled: boolean | null; fieldType: string; nameJson: unknown }[] = [];
  let ctxPageId: number | undefined;
  if (cfg.source === "custom" && cfg.pageId != null) {
    const [ctxPage] = await db
      .select({ mirrorEntityId: pagesTable.mirrorEntityId, entityId: entitiesTable.id })
      .from(pagesTable)
      .leftJoin(entitiesTable, eq(entitiesTable.pageId, pagesTable.id))
      .where(eq(pagesTable.id, cfg.pageId))
      .limit(1);
    const ctxEntityId = ctxPage?.mirrorEntityId ?? ctxPage?.entityId ?? null;
    if (ctxEntityId === entityId) {
      ctxPageId = cfg.pageId;
      pageFields = await db
        .select({
          fieldKey: pageFieldsTable.fieldKey,
          pivotEnabled: pageFieldsTable.pivotEnabled,
          fieldType: pageFieldsTable.fieldType,
          nameJson: pageFieldsTable.nameJson,
        })
        .from(pageFieldsTable)
        .where(and(eq(pageFieldsTable.pageId, cfg.pageId), eq(pageFieldsTable.isActive, true)));
    }
  }

  const outcome = await computePivot({
    entityId,
    pivot,
    entityFields: fields,
    relationMeta,
    pageFields,
    pageId: ctxPageId,
    where: and(...clauses)!,
  });
  if (!outcome.ok) {
    // An invalid stored config (e.g. a field lost its pivot opt-in) degrades to an
    // empty result rather than erroring the whole page.
    res.json(emptyPivotResult());
    return;
  }
  res.json(outcome.result);
});

router.put("/pages/:id", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = UpdatePageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const body = parsed.data;
  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.descriptionJson != null) updateData.descriptionJson = body.descriptionJson;
  if (body.icon != null) updateData.icon = body.icon;
  if ("path" in body) updateData.path = body.path ?? null;
  if ("parentPageId" in body) updateData.parentPageId = body.parentPageId ?? null;
  if ("mirrorEntityId" in body) updateData.mirrorEntityId = body.mirrorEntityId ?? null;
  if ("mirrorFieldKeysJson" in body) updateData.mirrorFieldKeysJson = body.mirrorFieldKeysJson ?? null;
  if ("mirrorFieldLabelsJson" in body) updateData.mirrorFieldLabelsJson = body.mirrorFieldLabelsJson ?? null;
  if ("mirrorColumnOrderJson" in body) updateData.mirrorColumnOrderJson = body.mirrorColumnOrderJson ?? null;
  if ("columnGroupsJson" in body) updateData.columnGroupsJson = body.columnGroupsJson ?? null;
  if ("mirrorPinnedJson" in body) updateData.mirrorPinnedJson = body.mirrorPinnedJson ?? null;
  if ("isDashboard" in body) updateData.isDashboard = body.isDashboard ?? false;
  if ("isPivot" in body) updateData.isPivot = body.isPivot ?? false;
  if ("pivotEntityId" in body) updateData.pivotEntityId = body.pivotEntityId ?? null;
  if ("pivotConfigJson" in body) updateData.pivotConfigJson = body.pivotConfigJson ?? null;
  if ("widgetsCollapsedDefault" in body) updateData.widgetsCollapsedDefault = body.widgetsCollapsedDefault ?? false;
  if ("defaultQuickFilterJson" in body) updateData.defaultQuickFilterJson = body.defaultQuickFilterJson ?? null;
  if ("groupByFieldKey" in body) updateData.groupByFieldKey = body.groupByFieldKey || null;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;

  if (body.parentPageId != null && body.parentPageId === params.data.id) {
    res.status(400).json({ error: "A page cannot be its own parent" });
    return;
  }

  if (body.mirrorEntityId != null && !(await entityExists(body.mirrorEntityId))) {
    res.status(400).json({ error: "Mirror entity not found" });
    return;
  }

  // Enforce the dashboard ⊥ mirror ⊥ bound-entity exclusivity against the
  // EFFECTIVE final state (current row merged with this patch), not just the
  // fields present in the request — otherwise e.g. flipping only isDashboard on a
  // page that already mirrors an entity would slip through.
  const [current] = await db
    .select({
      mirrorEntityId: pagesTable.mirrorEntityId,
      isDashboard: pagesTable.isDashboard,
      isPivot: pagesTable.isPivot,
      pivotEntityId: pagesTable.pivotEntityId,
      groupByFieldKey: pagesTable.groupByFieldKey,
    })
    .from(pagesTable)
    .where(eq(pagesTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  const effMirrorEntityId =
    "mirrorEntityId" in updateData ? (updateData.mirrorEntityId as number | null) : current.mirrorEntityId;
  const effIsDashboard =
    "isDashboard" in updateData ? (updateData.isDashboard as boolean) : current.isDashboard;
  const effIsPivot =
    "isPivot" in updateData ? (updateData.isPivot as boolean) : current.isPivot;
  const effPivotEntityId =
    "pivotEntityId" in updateData ? (updateData.pivotEntityId as number | null) : current.pivotEntityId;
  const hasBoundEntity = await pageHasBoundEntity(params.data.id);

  if (effMirrorEntityId != null && hasBoundEntity) {
    res.status(409).json({
      error: "This page already has a bound entity; it cannot also mirror an entity",
    });
    return;
  }
  if (effIsDashboard && effMirrorEntityId != null) {
    res.status(409).json({ error: "A dashboard page cannot also mirror an entity" });
    return;
  }
  if (effIsDashboard && hasBoundEntity) {
    res.status(409).json({ error: "This page already has a bound entity; it cannot be a dashboard" });
    return;
  }

  // Pivot exclusivity against the effective final state: pivot ⊥ dashboard ⊥
  // mirror ⊥ bound-entity, plus the pivot target entity must exist.
  if (effIsPivot) {
    if (effPivotEntityId == null) {
      res.status(400).json({ error: "A pivot page requires a target entity" });
      return;
    }
    if (!(await entityExists(effPivotEntityId))) {
      res.status(400).json({ error: "Pivot entity not found" });
      return;
    }
    if (effMirrorEntityId != null) {
      res.status(409).json({ error: "A pivot page cannot also mirror an entity" });
      return;
    }
    if (effIsDashboard) {
      res.status(409).json({ error: "A pivot page cannot also be a dashboard" });
      return;
    }
    if (hasBoundEntity) {
      res.status(409).json({ error: "This page already has a bound entity; it cannot be a pivot page" });
      return;
    }
  }

  // Grouping against the EFFECTIVE final state: explicitly setting a group on a
  // non-mirror page is an error; a page that STOPS being a mirror silently
  // drops its stale grouping instead of blocking the type change.
  const effGroupBy =
    "groupByFieldKey" in updateData ? (updateData.groupByFieldKey as string | null) : current.groupByFieldKey;
  if (effGroupBy != null) {
    if (effMirrorEntityId == null) {
      if ("groupByFieldKey" in body && body.groupByFieldKey) {
        res.status(400).json({ error: "Grouping is only available on mirror pages" });
        return;
      }
      updateData.groupByFieldKey = null;
    } else {
      const gErr = await validateGroupByField(effMirrorEntityId, effGroupBy);
      if (gErr) {
        res.status(400).json({ error: gErr });
        return;
      }
    }
  }

  const [page] = await db
    .update(pagesTable)
    .set(updateData)
    .where(eq(pagesTable.id, params.data.id))
    .returning();

  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json({ ...page, children: [] });
});

router.delete("/pages/:id", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = DeletePageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const children = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.parentPageId, params.data.id));

  if (children.length > 0) {
    res.status(409).json({ error: "Cannot delete a page that has sub-pages" });
    return;
  }

  const [deleted] = await db
    .delete(pagesTable)
    .where(eq(pagesTable.id, params.data.id))
    .returning({ id: pagesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json({ success: true, message: "Page deleted" });
});

export default router;
