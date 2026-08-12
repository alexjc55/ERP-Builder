import { Router, type IRouter } from "express";
import {
  db,
  relationsTable,
  recordLinksTable,
  entitiesTable,
  entityRecordsTable,
  RELATION_TYPES,
  type RelationType,
} from "@workspace/db";
import { eq, and, or, ne, asc, desc, inArray, sql } from "drizzle-orm";
import { relationLinkLockViolation } from "../lib/relation-lock";
import { emitLinkChangedEvents } from "../lib/record-links";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, getPermissions, canRecord, effectiveScope, effectiveStatusVisibility } from "../middlewares/permissions";
import { isRecordOwned } from "./own-scope";
import { loadActiveFields, fieldAccessContext, presentRecord } from "./records";
import {
  ListEntityRelationsParams,
  CreateEntityRelationParams,
  CreateEntityRelationBody,
  GetRelationParams,
  UpdateRelationParams,
  UpdateRelationBody,
  DeleteRelationParams,
  ListRecordLinksParams,
  CreateRecordLinkParams,
  CreateRecordLinkBody,
  DeleteRecordLinkParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const RELATION_KEY_RE = /^[a-z][a-z0-9_]*$/;

// Drizzle wraps the pg driver error, so the original code/constraint can live on
// err.cause rather than the top-level error. Walk the cause chain to find it.
function uniqueViolationConstraint(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const obj = e as { code?: string; constraint?: string; cause?: unknown };
    if (obj.code === "23505") {
      return obj.constraint ?? "";
    }
    e = obj.cause;
  }
  return null;
}

// Same cause-chain walk for FK violations (23503). A record can be deleted
// between our pre-insert existence check and the insert; the FK fires and we map
// it deterministically by which column's constraint failed.
function fkViolationConstraint(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const obj = e as { code?: string; constraint?: string; cause?: unknown };
    if (obj.code === "23503") {
      return obj.constraint ?? "";
    }
    e = obj.cause;
  }
  return null;
}

async function entityExists(entityId: number): Promise<boolean> {
  const [row] = await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.id, entityId)).limit(1);
  return Boolean(row);
}

async function recordEntityId(recordId: number): Promise<number | null> {
  const [row] = await db
    .select({ entityId: entityRecordsTable.entityId })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, recordId))
    .limit(1);
  return row ? row.entityId : null;
}

// ---- Relations metadata ----

router.get("/entities/:entityId/relations", requireAuth, async (req, res): Promise<void> => {
  const params = ListEntityRelationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const relations = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.sourceEntityId, params.data.entityId))
    .orderBy(asc(relationsTable.id));
  res.json(relations);
});

router.post("/entities/:entityId/relations", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = CreateEntityRelationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateEntityRelationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const sourceEntityId = params.data.entityId;
  if (!(await entityExists(sourceEntityId))) {
    res.status(404).json({ error: "Source entity not found" });
    return;
  }
  if (!RELATION_KEY_RE.test(body.data.relationKey)) {
    res.status(400).json({ error: "relationKey must match ^[a-z][a-z0-9_]*$" });
    return;
  }
  if (!RELATION_TYPES.includes(body.data.relationType as RelationType)) {
    res.status(400).json({ error: "Invalid relationType" });
    return;
  }
  if (!(await entityExists(body.data.targetEntityId))) {
    res.status(400).json({ error: "Target entity not found" });
    return;
  }
  try {
    const [relation] = await db
      .insert(relationsTable)
      .values({
        sourceEntityId,
        targetEntityId: body.data.targetEntityId,
        relationKey: body.data.relationKey,
        relationType: body.data.relationType,
        nameJson: body.data.nameJson,
        inverseNameJson: body.data.inverseNameJson ?? {},
        settingsJson: body.data.settingsJson ?? {},
      })
      .returning();
    res.status(201).json(relation);
  } catch (err) {
    if (uniqueViolationConstraint(err) === "relation_source_key_unique") {
      res.status(409).json({ error: "A relation with this key already exists on this entity" });
      return;
    }
    throw err;
  }
});

router.get("/relations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRelationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, params.data.id)).limit(1);
  if (!relation) {
    res.status(404).json({ error: "Relation not found" });
    return;
  }
  res.json(relation);
});

router.put("/relations/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = UpdateRelationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRelationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, params.data.id)).limit(1);
  if (!relation) {
    res.status(404).json({ error: "Relation not found" });
    return;
  }

  const updates: Partial<typeof relationsTable.$inferInsert> = {};
  if (body.data.relationKey !== undefined) {
    if (!RELATION_KEY_RE.test(body.data.relationKey)) {
      res.status(400).json({ error: "relationKey must match ^[a-z][a-z0-9_]*$" });
      return;
    }
    updates.relationKey = body.data.relationKey;
  }
  if (body.data.nameJson !== undefined) updates.nameJson = body.data.nameJson;
  if (body.data.inverseNameJson !== undefined) updates.inverseNameJson = body.data.inverseNameJson;
  if (body.data.settingsJson !== undefined) updates.settingsJson = body.data.settingsJson;

  const wantsTypeChange =
    body.data.relationType !== undefined && body.data.relationType !== relation.relationType;
  if (wantsTypeChange && !RELATION_TYPES.includes(body.data.relationType as RelationType)) {
    res.status(400).json({ error: "Invalid relationType" });
    return;
  }

  if (Object.keys(updates).length === 0 && !wantsTypeChange) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    // Lock the relation row for the whole mutation. A concurrent link-creation also
    // locks this row before copying relationType into record_links, so the
    // "no links exist" check and the type change cannot interleave with an insert
    // that would otherwise leave record_links.relationType drifted from the parent.
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: relationsTable.id })
        .from(relationsTable)
        .where(eq(relationsTable.id, relation.id))
        .limit(1)
        .for("update");
      if (!locked) return { status: 404 as const, error: "Relation not found" };

      if (wantsTypeChange) {
        const newType = body.data.relationType as RelationType;
        // The new type isn't just a label: it's a cardinality RULE backed by the
        // partial-unique indexes on record_links (source unique for
        // one_to_one/many_to_one, target unique for one_to_one/one_to_many;
        // many_to_many has no constraint). Existing links may already violate the
        // new rule, so we can't blindly rewrite — we verify compatibility first.
        const needsSourceUnique = newType === "one_to_one" || newType === "many_to_one";
        const needsTargetUnique = newType === "one_to_one" || newType === "one_to_many";

        // Count records that already hold MORE THAN ONE link on a side the new
        // type would require to be unique. These are exactly the rows the partial
        // unique index would reject. Done under the relation row lock, so no
        // concurrent insert can slip a new conflicting link past this check.
        let sourceConflicts = 0;
        if (needsSourceUnique) {
          const dups = await tx
            .select({ sid: recordLinksTable.sourceRecordId })
            .from(recordLinksTable)
            .where(eq(recordLinksTable.relationId, relation.id))
            .groupBy(recordLinksTable.sourceRecordId)
            .having(sql`count(*) > 1`);
          sourceConflicts = dups.length;
        }
        let targetConflicts = 0;
        if (needsTargetUnique) {
          const dups = await tx
            .select({ tid: recordLinksTable.targetRecordId })
            .from(recordLinksTable)
            .where(eq(recordLinksTable.relationId, relation.id))
            .groupBy(recordLinksTable.targetRecordId)
            .having(sql`count(*) > 1`);
          targetConflicts = dups.length;
        }

        if (sourceConflicts > 0 || targetConflicts > 0) {
          const parts: string[] = [];
          if (sourceConflicts > 0) {
            parts.push(`записей-источников с несколькими связями: ${sourceConflicts}`);
          }
          if (targetConflicts > 0) {
            parts.push(`целевых записей с несколькими связями: ${targetConflicts}`);
          }
          return {
            status: 409 as const,
            error: `Нельзя изменить тип связи: текущие данные не соответствуют новому правилу (${parts.join("; ")}). Уберите лишние связи у этих записей, затем повторите.`,
          };
        }

        // Compatible: change the parent type AND rewrite the copied type on every
        // existing link so record_links.relationType never drifts from the parent
        // (the partial-unique indexes are evaluated off that copied column).
        updates.relationType = newType;
        await tx
          .update(recordLinksTable)
          .set({ relationType: newType })
          .where(eq(recordLinksTable.relationId, relation.id));
      }

      const [updated] = await tx
        .update(relationsTable)
        .set(updates)
        .where(eq(relationsTable.id, relation.id))
        .returning();
      return { status: 200 as const, relation: updated };
    });
    if (result.status === 200) {
      res.json(result.relation);
      return;
    }
    res.status(result.status).json({ error: result.error });
  } catch (err) {
    if (uniqueViolationConstraint(err) === "relation_source_key_unique") {
      res.status(409).json({ error: "A relation with this key already exists on this entity" });
      return;
    }
    throw err;
  }
});

router.delete("/relations/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = DeleteRelationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(relationsTable).where(eq(relationsTable.id, params.data.id)).returning({ id: relationsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Relation not found" });
    return;
  }
  res.json({ success: true });
});

// ---- Record links (data) ----

// Full read boundary for the linked-records listing. The source record must be
// visible to the viewer exactly like GET /records/:id (view perm + own-scope +
// row-hidden status), and every linked record is re-checked against ITS entity's
// boundary — invisible rows are silently dropped (never a leak, never a 403 that
// reveals existence). Hidden fields are stripped per entity via presentRecord.
router.get("/records/:recordId/links", requireAuth, async (req, res): Promise<void> => {
  const params = ListRecordLinksParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const recordId = params.data.recordId;
  const [source] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId)).limit(1);
  if (!source) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const perms = await getPermissions(req);
  if (!canRecord(perms, source.entityId, "view")) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const sourceFields = await loadActiveFields(source.entityId);
  const { scope: srcScope, scopeFieldKeys: srcScopeKeys } = effectiveScope(perms, source.entityId);
  if (srcScope === "own" && !(await isRecordOwned(source.entityId, source, srcScopeKeys, req.user!.userId, sourceFields))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const srcVis = effectiveStatusVisibility(perms, source.entityId);
  if (source.statusId != null && srcVis.hiddenRowStatusIds.includes(source.statusId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  // ?direction=both also returns links where this record is the TARGET (the
  // other record then comes back as `record`). Default stays source-only for
  // backward compatibility with existing UI consumers.
  const both = req.query.direction === "both";
  const links = await db
    .select()
    .from(recordLinksTable)
    .where(
      both
        ? or(eq(recordLinksTable.sourceRecordId, recordId), eq(recordLinksTable.targetRecordId, recordId))
        : eq(recordLinksTable.sourceRecordId, recordId),
    )
    .orderBy(desc(recordLinksTable.createdAt));

  if (links.length === 0) {
    res.json([]);
    return;
  }

  const otherIds = [...new Set(links.map((l) => (l.sourceRecordId === recordId ? l.targetRecordId : l.sourceRecordId)))];
  const others = await db.select().from(entityRecordsTable).where(inArray(entityRecordsTable.id, otherIds));
  const otherById = new Map(others.map((t) => [t.id, t]));

  // Per-entity boundary context, computed once per linked entity.
  type EntityCtx = {
    visible: boolean;
    fields: Awaited<ReturnType<typeof loadActiveFields>>;
    scope: ReturnType<typeof effectiveScope>;
    hiddenRowStatusIds: number[];
    hidden: Set<string>;
  };
  const ctxByEntity = new Map<number, EntityCtx>();
  const entityCtx = async (entityId: number): Promise<EntityCtx> => {
    let ctx = ctxByEntity.get(entityId);
    if (!ctx) {
      if (!canRecord(perms, entityId, "view")) {
        ctx = { visible: false, fields: [], scope: { scope: "all", scopeFieldKeys: [] }, hiddenRowStatusIds: [], hidden: new Set() };
      } else {
        const fields = await loadActiveFields(entityId);
        const { hidden } = await fieldAccessContext(req, entityId, fields);
        ctx = {
          visible: true,
          fields,
          scope: effectiveScope(perms, entityId),
          hiddenRowStatusIds: effectiveStatusVisibility(perms, entityId).hiddenRowStatusIds,
          hidden,
        };
      }
      ctxByEntity.set(entityId, ctx);
    }
    return ctx;
  };

  const result: Array<{ linkId: number; relationId: number; direction: "source" | "target"; record: unknown }> = [];
  for (const link of links) {
    const otherId = link.sourceRecordId === recordId ? link.targetRecordId : link.sourceRecordId;
    const record = otherById.get(otherId);
    if (!record) continue;
    const ctx = await entityCtx(record.entityId);
    if (!ctx.visible) continue;
    if (record.statusId != null && ctx.hiddenRowStatusIds.includes(record.statusId)) continue;
    if (ctx.scope.scope === "own" && !(await isRecordOwned(record.entityId, record, ctx.scope.scopeFieldKeys, req.user!.userId, ctx.fields))) continue;
    result.push({
      linkId: link.id,
      relationId: link.relationId,
      direction: link.sourceRecordId === recordId ? "source" : "target",
      record: presentRecord(record, ctx.hidden, ctx.fields),
    });
  }

  res.json(result);
});

router.post("/records/:recordId/links", requireAuth, async (req, res): Promise<void> => {
  const params = CreateRecordLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateRecordLinkBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const sourceRecordId = params.data.recordId;
  const { relationId, targetRecordId } = body.data;

  const srcEntity = await recordEntityId(sourceRecordId);
  if (srcEntity === null) {
    res.status(404).json({ error: "Source record not found" });
    return;
  }
  const perms = await getPermissions(req);
  if (!canRecord(perms, srcEntity, "update")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const tgtEntity = await recordEntityId(targetRecordId);
  if (tgtEntity === null) {
    res.status(400).json({ error: "Target record not found" });
    return;
  }

  try {
    // Lock the relation row before reading its type and inserting the link. This
    // pairs with the lock in PUT /relations/:id so the type copied into
    // record_links.relationType can never drift from the parent relation under
    // concurrent type changes (the partial-unique cardinality indexes rely on it).
    const result = await db.transaction(async (tx) => {
      const [relation] = await tx
        .select()
        .from(relationsTable)
        .where(eq(relationsTable.id, relationId))
        .limit(1)
        .for("update");
      if (!relation) return { status: 400 as const, error: "Relation not found" };
      if (srcEntity !== relation.sourceEntityId) {
        return { status: 400 as const, error: "Source record does not belong to the relation's source entity" };
      }
      if (tgtEntity !== relation.targetEntityId) {
        return { status: 400 as const, error: "Target record does not belong to the relation's target entity" };
      }
      // Immutability boundary for lockAfterCreate relation fields, checked under
      // the relation row lock (TOCTOU-free). A relation field can sit on either
      // side of the relation, so guard both the source and target ends.
      const srcViolation = await relationLinkLockViolation(
        tx, srcEntity, relationId, sourceRecordId, "source", targetRecordId,
      );
      if (srcViolation) return { status: 400 as const, error: srcViolation };
      const tgtViolation = await relationLinkLockViolation(
        tx, tgtEntity, relationId, targetRecordId, "target", sourceRecordId,
      );
      if (tgtViolation) return { status: 400 as const, error: tgtViolation };
      const [link] = await tx
        .insert(recordLinksTable)
        .values({ relationId, relationType: relation.relationType, sourceRecordId, targetRecordId })
        .returning();
      return { status: 201 as const, link };
    });
    if (result.status === 201) {
      // A link change alters the record's effective relation value even though
      // values_json is untouched — notify both ends so automations can react.
      await emitLinkChangedEvents({
        entityId: srcEntity,
        baseRecordId: sourceRecordId,
        relatedEntityId: tgtEntity,
        affectedLinkedIds: [targetRecordId],
        actorUserId: req.user?.userId,
        log: req.log,
      });
      res.status(201).json(result.link);
      return;
    }
    res.status(result.status).json({ error: result.error });
  } catch (err) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === "record_link_unique") {
      res.status(409).json({ error: "These records are already linked" });
      return;
    }
    if (constraint === "record_link_source_one") {
      res.status(409).json({ error: "This source record can only be linked to one target under this relation" });
      return;
    }
    if (constraint === "record_link_target_one") {
      res.status(409).json({ error: "This target record can only be linked to one source under this relation" });
      return;
    }
    const fk = fkViolationConstraint(err);
    if (fk !== null) {
      // A source/target record (or the relation) was deleted concurrently between
      // our existence check and the insert. Map to a deterministic 4xx, not a 500.
      if (fk.includes("source_record_id")) {
        res.status(404).json({ error: "Source record no longer exists" });
        return;
      }
      if (fk.includes("target_record_id")) {
        res.status(400).json({ error: "Target record no longer exists" });
        return;
      }
      if (fk.includes("relation_id")) {
        res.status(400).json({ error: "Relation no longer exists" });
        return;
      }
      res.status(400).json({ error: "A referenced record no longer exists" });
      return;
    }
    throw err;
  }
});

router.delete("/links/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteRecordLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [link] = await db
    .select({
      id: recordLinksTable.id,
      relationId: recordLinksTable.relationId,
      sourceRecordId: recordLinksTable.sourceRecordId,
      targetRecordId: recordLinksTable.targetRecordId,
    })
    .from(recordLinksTable)
    .where(eq(recordLinksTable.id, params.data.id))
    .limit(1);
  if (!link) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  const srcEntity = await recordEntityId(link.sourceRecordId);
  const perms = await getPermissions(req);
  if (srcEntity === null || !canRecord(perms, srcEntity, "update")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Deleting a link clears the value of any relation field backing it. If that
  // field is lockAfterCreate, clearing is forbidden — guard both ends (the
  // locked field can sit on either side of the relation). The guard + delete run
  // under the relation FOR UPDATE lock, matching the other write paths, so a
  // concurrent set/delete cannot slip past the immutability boundary.
  const tgtEntity = await recordEntityId(link.targetRecordId);
  const delError = await db.transaction(async (tx) => {
    await tx
      .select({ id: relationsTable.id })
      .from(relationsTable)
      .where(eq(relationsTable.id, link.relationId))
      .limit(1)
      .for("update");
    const srcViolation = await relationLinkLockViolation(
      tx, srcEntity, link.relationId, link.sourceRecordId, "source", null,
    );
    if (srcViolation) return srcViolation;
    if (tgtEntity !== null) {
      const tgtViolation = await relationLinkLockViolation(
        tx, tgtEntity, link.relationId, link.targetRecordId, "target", null,
      );
      if (tgtViolation) return tgtViolation;
    }
    await tx.delete(recordLinksTable).where(eq(recordLinksTable.id, params.data.id));
    return null;
  });
  if (delError) {
    res.status(400).json({ error: delError });
    return;
  }
  // Mirror the link-create path: a removed link changes the effective relation
  // value of both records, so let automations re-sync.
  await emitLinkChangedEvents({
    entityId: srcEntity,
    baseRecordId: link.sourceRecordId,
    relatedEntityId: tgtEntity ?? srcEntity,
    affectedLinkedIds: tgtEntity !== null ? [link.targetRecordId] : [],
    actorUserId: req.user?.userId,
    log: req.log,
  });
  res.json({ success: true });
});

export default router;
