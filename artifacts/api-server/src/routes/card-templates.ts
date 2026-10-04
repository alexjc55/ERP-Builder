import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db, cardTemplatesTable as cards, cardTemplateInputSchema, entitiesTable, pagesTable, entityFieldsTable, relationsTable, type CardLayout } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, assertRecord, getPermissions, getUserRoleIds, resolveFieldAccess, effectiveRecordPerm } from "../middlewares/permissions";
import { ResolveCardTemplateBody, PublishCardTemplateBody } from "@workspace/api-zod";

const router: IRouter = Router();
type Reader = Pick<typeof db, "select">;
const idSchema = { safeParse: (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0
    ? { success: true as const, data: id }
    : { success: false as const, data: 0 };
} };
const scopeWhere = (entityId: number, pageId: number | null) =>
  and(eq(cards.entityId, entityId), pageId === null ? isNull(cards.pageId) : eq(cards.pageId, pageId));

async function scopeValid(reader: Reader, entityId: number, pageId: number | null) {
  const [entity] = await reader.select().from(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (!entity?.isActive) return false;
  if (pageId === null) return true;
  const [page] = await reader.select().from(pagesTable).where(eq(pagesTable.id, pageId));
  return !!page?.isActive && (page.mirrorEntityId === entityId || entity.pageId === pageId);
}

/** Incomplete drafts are allowed; only publication requires usable bindings. */
async function publicationErrors(reader: Reader, entityId: number, layout: CardLayout) {
  const fields = await reader.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const fieldMap = new Map(fields.map(f => [f.fieldKey, f]));
  const seen = new Set<string>(), nodeIds = new Set<string>(), errors: string[] = [];
  const register = (id: string) => { if (nodeIds.has(id)) errors.push(`Duplicate layout id: ${id}`); nodeIds.add(id); };
  for (const tab of layout.tabs) {
    register(tab.id);
    for (const section of tab.sections) {
      register(section.id);
      for (const row of section.rows ?? []) register(row.id);
      for (const block of section.blocks) {
        register(block.id);
        if (block.kind !== "field" && block.kind !== "relatedTable") continue;
        const f = block.fieldKey ? fieldMap.get(block.fieldKey) : undefined;
        if (!f) continue; // Unbound or removed fields are intentional empty cells.
        for (const mode of block.modes) {
          const key = `${mode}:${f.fieldKey}`;
          if (seen.has(key)) errors.push(`Field ${f.fieldKey} appears twice in ${mode}`);
          seen.add(key);
        }
        if (block.kind !== "relatedTable") continue;
        if (f.fieldType !== "relation" || f.relationConfigJson?.selectionMode !== "multiple" || !f.relationConfigJson?.relationId) {
          errors.push(`${f.fieldKey}: a related table requires a multiple relation`); continue;
        }
        const [relation] = await reader.select().from(relationsTable).where(eq(relationsTable.id, f.relationConfigJson.relationId));
        if (!relation || (relation.sourceEntityId !== entityId && relation.targetEntityId !== entityId)) {
          errors.push(`${f.fieldKey}: relation not found`); continue;
        }
        const targetId = relation.sourceEntityId === entityId ? relation.targetEntityId : relation.sourceEntityId;
        const targetFields = await reader.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, targetId), eq(entityFieldsTable.isActive, true)));
        if (!block.columns.length) errors.push(`${f.fieldKey}: choose table columns`);
        for (const key of block.columns) if (!targetFields.some(f => f.fieldKey === key)) errors.push(`${f.fieldKey}: unknown related column ${key}`);
      }
    }
  }
  return errors;
}

router.post("/card-templates/resolve", requireAuth, async (req, res) => {
  const parsed = ResolveCardTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { entityId, pageId, mode } = parsed.data;
  if (!Number.isSafeInteger(entityId) || entityId <= 0 || (pageId != null && (!Number.isSafeInteger(pageId) || pageId <= 0))) {
    res.status(400).json({ error: "Invalid scope" }); return;
  }
  if (!await scopeValid(db, entityId, pageId ?? null)) { res.status(404).json({ error: "Entity/page not found" }); return; }
  const perms = await getPermissions(req);
  if (pageId != null && !perms.superAdmin && !perms.pageIds.includes(pageId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!await assertRecord(req, res, entityId, mode === "edit" ? "update" : mode === "create" ? "create" : "view", pageId)) return;
  const matches = await db.select().from(cards).where(and(
    eq(cards.entityId, entityId), eq(cards.state, "published"),
    pageId == null ? isNull(cards.pageId) : or(isNull(cards.pageId), eq(cards.pageId, pageId)),
  ));
  const template = matches.find(c => c.pageId === pageId) ?? matches.find(c => c.pageId === null);
  if (!template) { res.json({ template: null }); return; }
  const roleIds = await getUserRoleIds(req);
  const fields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const recordPerm = await effectiveRecordPerm(req, perms, entityId, pageId);
  const visible = new Set(fields.filter(f => resolveFieldAccess(f, perms, roleIds, entityId, recordPerm, pageId) !== "hidden").map(f => f.fieldKey));
  const layout = structuredClone(template.layout);
  const activeKeys = new Set(fields.map(f => f.fieldKey));
  for (const tab of layout.tabs) for (const section of tab.sections) {
    section.blocks = section.blocks.filter(b => b.kind === "text" || b.kind === "divider" || !b.fieldKey || !activeKeys.has(b.fieldKey) || visible.has(b.fieldKey))
      .map(b => (b.kind === "field" || b.kind === "relatedTable") && (!b.fieldKey || !activeKeys.has(b.fieldKey))
        ? { ...b, fieldKey: null, columns: [], label: {} } : b);
    if (section.rows) {
      const visibleIds = new Set(section.blocks.map(b => b.id));
      section.rows = section.rows.map(row => ({ ...row, blockIds: row.blockIds.filter(id => visibleIds.has(id)) }));
    }
  }
  res.json({ template: { ...template, layout } });
});

router.get("/card-templates", requireAuth, requireAdmin("cardTemplates"), async (_req, res) => {
  res.json(await db.select().from(cards).orderBy(asc(cards.id)));
});

router.post("/card-templates", requireAuth, requireAdmin("cardTemplates"), async (req, res) => {
  const body = cardTemplateInputSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const { expectedRevision: _revision, ...input } = body.data;
  if (!await scopeValid(db, input.entityId, input.pageId)) { res.status(400).json({ error: "Page must belong to selected entity" }); return; }
  const [row] = await db.insert(cards).values({ ...input, state: "draft" }).returning();
  res.status(201).json(row);
});

router.put("/card-templates/:id", requireAuth, requireAdmin("cardTemplates"), async (req, res) => {
  const id = idSchema.safeParse(req.params.id), body = cardTemplateInputSchema.safeParse(req.body);
  if (!id.success || !body.success || !body.data.expectedRevision) { res.status(400).json({ error: "Valid template and expectedRevision are required" }); return; }
  const { expectedRevision, ...input } = body.data;
  if (!await scopeValid(db, input.entityId, input.pageId)) { res.status(400).json({ error: "Page must belong to selected entity" }); return; }
  const [row] = await db.update(cards).set({ ...input, updatedAt: new Date(), revision: sql`${cards.revision} + 1` })
    .where(and(eq(cards.id, id.data), eq(cards.state, "draft"), eq(cards.revision, expectedRevision))).returning();
  if (!row) { res.status(409).json({ error: "Template changed or is published. Reload or create a draft copy." }); return; }
  res.json(row);
});

router.delete("/card-templates/:id", requireAuth, requireAdmin("cardTemplates"), async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(cards).where(and(eq(cards.id, id.data), eq(cards.state, "draft"))).returning();
  if (!row) { res.status(409).json({ error: "Only existing drafts may be deleted" }); return; }
  res.sendStatus(204);
});

for (const action of ["publish", "unpublish"] as const) {
  router.post(`/card-templates/:id/${action}`, requireAuth, requireAdmin("cardTemplates"), async (req, res) => {
    const id = idSchema.safeParse(req.params.id), body = PublishCardTemplateBody.safeParse(req.body);
    if (!id.success || !body.success || !Number.isSafeInteger(body.data.expectedRevision)) { res.status(400).json({ error: "Invalid publication request" }); return; }
    const result = await db.transaction(async tx => {
      // Global, short-lived registry lock avoids cross-scope move deadlocks and
      // serializes both publish and unpublish. Unique indexes are defense in depth.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(782361904)`);
      const [card] = await tx.select().from(cards).where(eq(cards.id, id.data)).for("update");
      if (!card) return { status: 404, body: { error: "Template not found" } };
      if (card.revision !== body.data.expectedRevision) return { status: 409, body: { error: "Template changed. Reload before publishing." } };
      if (action === "unpublish") {
        const [row] = await tx.update(cards).set({ state: "draft", revision: card.revision + 1, updatedAt: new Date() }).where(eq(cards.id, card.id)).returning();
        return { status: 200, body: row };
      }
      if (card.state === "published") return { status: 200, body: card };
      if (!await scopeValid(tx, card.entityId, card.pageId)) return { status: 400, body: { error: "Page must belong to selected entity" } };
      const errors = await publicationErrors(tx, card.entityId, card.layout);
      if (errors.length) return { status: 400, body: { error: errors.join("\n") } };
      const [active] = await tx.select().from(cards).where(and(scopeWhere(card.entityId, card.pageId), eq(cards.state, "published"))).for("update");
      if (active && (body.data.replaceId !== active.id || body.data.replaceRevision !== active.revision)) {
        return { status: 409, body: { error: "Confirm moving the current published card to drafts", active } };
      }
      if (!active && body.data.replaceId != null) return { status: 409, body: { error: "Published card changed. Reload and publish again." } };
      if (active) await tx.update(cards).set({ state: "draft", revision: active.revision + 1, updatedAt: new Date() }).where(eq(cards.id, active.id));
      const [row] = await tx.update(cards).set({ state: "published", revision: card.revision + 1, updatedAt: new Date() }).where(eq(cards.id, card.id)).returning();
      return { status: 200, body: row };
    });
    res.status(result.status).json(result.body);
  });
}
export default router;