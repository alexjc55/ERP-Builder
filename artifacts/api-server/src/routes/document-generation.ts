import express, { Router, type IRouter } from "express";
import {
  db,
  documentTemplatesTable,
  documentTemplateRevisionsTable,
  documentGenerationRunsTable,
  entityFieldsTable,
  entitiesTable,
  entityRecordsTable,
  entityStatusesTable,
  pageFieldsTable,
  pagesTable,
  recordLinksTable,
  relationsTable,
  documentMappingSchema,
  documentGenerationOutputSchema,
  type DocumentMapping,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  ListDocumentTemplatesQueryParams,
  CreateDocumentTemplateBody,
  UpdateDocumentTemplateParams,
  UpdateDocumentTemplateBody,
  CreateDocumentTemplateRevisionParams,
  PublishDocumentTemplateRevisionParams,
  TestDocumentTemplateRevisionParams,
  TestDocumentTemplateRevisionBody,
  GenerateDocumentParams,
  GenerateDocumentBody,
  ListDocumentGenerationRunsQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { assertRecord, effectiveScope, effectiveStatusVisibility, getPermissions, getUserRoleIds, requireAdmin, resolveFieldAccess } from "../middlewares/permissions";
import { isRecordOwned } from "./own-scope";
import { parseDocxManifest, type DocumentManifest } from "../lib/document-docx";
import { generateDocument, isDocumentGenerationEnabled } from "../lib/document-generation";
import { interactiveFormulaPermissions } from "../lib/formula-runtime";
import type { LinkedFormulaPermissionContext } from "../lib/linked-formula-resolver";
import { deleteLocalFile, saveLocalFile } from "../lib/localStorage";

const router: IRouter = Router();
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const requireDocumentModule: express.RequestHandler = async (_req, res, next) => {
  if (!(await isDocumentGenerationEnabled())) {
    res.status(403).json({ error: "Document generation module is disabled" });
    return;
  }
  next();
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function validateRevision(
  entityId: number,
  manifest: DocumentManifest,
  mapping: DocumentMapping,
): Promise<string[]> {
  const errors = [...manifest.errors];
  const fields = await db.select().from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  const validateSource = async (source: DocumentMapping["scalars"][string], context: string, sourceEntityId: number, sourceKeys: Set<string>) => {
    if (source.source === "field" && !sourceKeys.has(source.fieldKey)) errors.push(`Unknown field "${source.fieldKey}" for "${context}"`);
    if (source.source === "page") {
      const [page] = await db.select({ mirror: pagesTable.mirrorEntityId }).from(pagesTable).where(eq(pagesTable.id, source.pageId));
      const [owner] = await db.select({ pageId: entitiesTable.pageId }).from(entitiesTable).where(eq(entitiesTable.id, sourceEntityId));
      const [field] = await db.select({ id: pageFieldsTable.id }).from(pageFieldsTable)
        .where(and(eq(pageFieldsTable.pageId, source.pageId), eq(pageFieldsTable.fieldKey, source.fieldKey), eq(pageFieldsTable.isActive, true)));
      if (!page || (page.mirror !== sourceEntityId && owner?.pageId !== source.pageId) || !field) errors.push(`Unknown page-local field "${source.pageId}.${source.fieldKey}" for "${context}"`);
    }
  };
  for (const key of manifest.scalars) {
    const source = mapping.scalars[key];
    if (!source) errors.push(`Missing mapping for scalar "${key}"`);
    else await validateSource(source, key, entityId, new Set(byKey.keys()));
  }
  for (const extra of Object.keys(mapping.scalars)) if (!manifest.scalars.includes(extra)) errors.push(`Mapping has no scalar marker "${extra}"`);
  for (const [collection, itemKeys] of Object.entries(manifest.collections)) {
    const config = mapping.collections[collection];
    if (!config) {
      errors.push(`Missing mapping for collection "${collection}"`);
      continue;
    }
    const relation = byKey.get(config.relationFieldKey);
    if (!relation || (relation.fieldType !== "relation" && relation.fieldType !== "lookup")) {
      errors.push(`Collection "${collection}" must use a relation field`);
    } else if (relation.relationConfigJson?.relationId != null) {
      const [definition] = await db.select().from(relationsTable)
        .where(eq(relationsTable.id, relation.relationConfigJson.relationId));
      if (!definition) {
        errors.push(`Collection "${collection}" references a missing relation`);
      } else {
        const linkedEntityId = definition.sourceEntityId === entityId ? definition.targetEntityId : definition.sourceEntityId;
        const linkedFields = await db.select({ key: entityFieldsTable.fieldKey }).from(entityFieldsTable)
          .where(and(eq(entityFieldsTable.entityId, linkedEntityId), eq(entityFieldsTable.isActive, true)));
        const linkedKeys = new Set(linkedFields.map((f) => f.key));
        for (const [itemKey, source] of Object.entries(config.fields)) {
          await validateSource(source, `${collection}.${itemKey}`, linkedEntityId, linkedKeys);
        }
        for (const filter of config.filters) {
          if (filter.fieldKey !== "__status__" && !linkedKeys.has(filter.fieldKey)) {
            errors.push(`Unknown linked filter field "${filter.fieldKey}" for "${collection}"`);
          }
        }
      }
    } else {
      errors.push(`Collection "${collection}" relation is not configured`);
    }
    for (const key of itemKeys) if (!config.fields[key]) errors.push(`Missing mapping for "${collection}.${key}"`);
    for (const key of Object.keys(config.fields)) if (!itemKeys.includes(key)) errors.push(`Mapping has no collection marker "${collection}.${key}"`);
    for (const sort of config.sort) if (!config.fields[sort.fieldKey]) errors.push(`Unknown sort key "${collection}.${sort.fieldKey}"`);
  }
  for (const extra of Object.keys(mapping.collections)) if (!(extra in manifest.collections)) errors.push(`Mapping has no collection marker "${extra}"`);
  return [...new Set(errors)];
}

/** Bounded multipart parser for exactly one DOCX file plus mapping text field. */
export function parseRevisionMultipart(req: express.Request): { file: Buffer; name: string; mapping: string } | null {
  const contentType = req.header("content-type") ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] ?? /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  if (!boundary || !Buffer.isBuffer(req.body) || boundary.length > 200) return null;
  const marker = Buffer.from(`--${boundary}`);
  const parts: { headers: string; body: Buffer }[] = [];
  let offset = req.body.indexOf(marker);
  while (offset >= 0) {
    const headStart = offset + marker.length;
    if (req.body.subarray(headStart, headStart + 2).equals(Buffer.from("--"))) break;
    const contentStart = headStart + 2; // CRLF
    const headerEnd = req.body.indexOf(Buffer.from("\r\n\r\n"), contentStart);
    if (headerEnd < 0) return null;
    const next = req.body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (next < 0) return null;
    parts.push({ headers: req.body.subarray(contentStart, headerEnd).toString("utf8"), body: req.body.subarray(headerEnd + 4, next) });
    offset = next + 2;
  }
  const filePart = parts.find((p) => /name="file"/i.test(p.headers));
  const mappingPart = parts.find((p) => /name="mapping"/i.test(p.headers));
  const name = /filename="([^"]*)"/i.exec(filePart?.headers ?? "")?.[1];
  if (!filePart || !mappingPart || !name || !/content-type:\s*application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(filePart.headers))
    return null;
  return { file: filePart.body, name, mapping: mappingPart.body.toString("utf8") };
}

export function presentGenerationOutput(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const root = raw as Record<string, unknown>;
  const file = (root.file && typeof root.file === "object" && !Array.isArray(root.file) ? root.file : root) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (file.kind === "server") out.destination = "local";
  if (file.kind === "gdrive") out.destination = "gdrive";
  for (const key of ["name", "contentType", "size", "path", "fileId", "webViewLink"]) {
    if (typeof file[key] === "string" || typeof file[key] === "number") out[key] = file[key];
  }
  if (root.orphaned === true) out.orphaned = true;
  if (root.cleanup && typeof root.cleanup === "object" && !Array.isArray(root.cleanup)) {
    const cleanup = root.cleanup as Record<string, unknown>;
    out.cleanup = Object.fromEntries(["attempted", "deleted", "error"].filter((key) =>
      typeof cleanup[key] === "boolean" || typeof cleanup[key] === "string").map((key) => [key, cleanup[key]]));
  }
  return Object.keys(out).length ? out : undefined;
}

type DirectGenerationBoundary = {
  entityId: number;
  linkedRecordIds: ReadonlySet<number>;
  visibility: { entityFields: ReadonlyMap<number, ReadonlySet<string>>; pageFields: ReadonlyMap<number, ReadonlySet<string>>; formulaPermissions: LinkedFormulaPermissionContext };
};
async function enforceDirectGenerationBoundary(req: express.Request, res: express.Response, revisionId: number, recordId: number): Promise<DirectGenerationBoundary | false> {
  const [revision] = await db.select({ mapping: documentTemplateRevisionsTable.mappingJson, entityId: documentTemplatesTable.entityId })
    .from(documentTemplateRevisionsTable).innerJoin(documentTemplatesTable, eq(documentTemplatesTable.id, documentTemplateRevisionsTable.templateId))
    .where(eq(documentTemplateRevisionsTable.id, revisionId));
  if (!revision) { res.status(404).json({ error: "Document revision not found" }); return false; }
  if (!(await assertRecord(req, res, revision.entityId, "view"))) return false;
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const fields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, revision.entityId), eq(entityFieldsTable.isActive, true)));
  const [record] = await db.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.entityId, revision.entityId)));
  if (!record || record.archivedAt) { res.status(404).json({ error: "Record not found" }); return false; }
  const visibility = effectiveStatusVisibility(perms, revision.entityId);
  const scope = effectiveScope(perms, revision.entityId);
  if (visibility.hiddenRowStatusIds.includes(record.statusId ?? -1) ||
      (scope.scope === "own" && !(await isRecordOwned(revision.entityId, record, scope.scopeFieldKeys, req.user!.userId, fields)))) {
    res.status(403).json({ error: "Record is outside the caller's visible row scope" }); return false;
  }
  const mapping = documentMappingSchema.parse(revision.mapping);
  const allowedLinkedRecordIds = new Set<number>();
  const visibleEntityFields = new Map<number, ReadonlySet<string>>();
  const visiblePageFields = new Map<number, ReadonlySet<string>>();
  visibleEntityFields.set(revision.entityId, new Set(fields.filter((f) => resolveFieldAccess(f, perms, roleIds, revision.entityId) !== "hidden").map((f) => f.fieldKey)));
  const assertSources = (sources: DocumentMapping["scalars"][string][], sourceFields: typeof fields, sourceEntityId: number) => {
    for (const source of sources) {
      if (source.source === "field") {
        const field = sourceFields.find((f) => f.fieldKey === source.fieldKey);
        if (!field || resolveFieldAccess(field, perms, roleIds, sourceEntityId) === "hidden") return false;
      }
    }
    return true;
  };
  const assertPageSources = async (sources: DocumentMapping["scalars"][string][]) => {
    for (const source of sources) {
      if (source.source !== "page") continue;
      if (!perms.superAdmin && !(perms.pageIds ?? []).includes(source.pageId)) return false;
      const [pageField] = await db.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, source.pageId), eq(pageFieldsTable.fieldKey, source.fieldKey), eq(pageFieldsTable.isActive, true)));
      const pagePerms = pageField?.permissionsJson as Record<string, string> | undefined;
      if (!pageField || (!perms.superAdmin && roleIds.length > 0 && roleIds.every((id) => pagePerms?.[String(id)] === "hidden"))) return false;
      if (!visiblePageFields.has(source.pageId)) {
        const all = await db.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, source.pageId), eq(pageFieldsTable.isActive, true)));
        visiblePageFields.set(source.pageId, new Set(all.filter((f) => {
          const fp = f.permissionsJson as Record<string, string> | undefined;
          return perms.superAdmin || !roleIds.every((id) => fp?.[String(id)] === "hidden");
        }).map((f) => f.fieldKey)));
      }
    }
    return true;
  };
  if (!assertSources(Object.values(mapping.scalars), fields, revision.entityId) || !(await assertPageSources(Object.values(mapping.scalars)))) {
    res.status(403).json({ error: "Mapping references a hidden source field" }); return false;
  }
  for (const config of Object.values(mapping.collections)) {
    const relationField = fields.find((f) => f.fieldKey === config.relationFieldKey);
    if (!relationField || resolveFieldAccess(relationField, perms, roleIds, revision.entityId) === "hidden") {
      res.status(403).json({ error: "Mapping references a hidden relation field" }); return false;
    }
    const relationId = relationField.relationConfigJson?.relationId;
    const [relation] = relationId == null ? [] : await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    if (!relation) continue;
    const sourceSide = relation.sourceEntityId === revision.entityId;
    const linkedEntityId = sourceSide ? relation.targetEntityId : relation.sourceEntityId;
    if (!(await assertRecord(req, res, linkedEntityId, "view"))) return false;
    const linkedFields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, linkedEntityId), eq(entityFieldsTable.isActive, true)));
    visibleEntityFields.set(linkedEntityId, new Set(linkedFields.filter((f) => resolveFieldAccess(f, perms, roleIds, linkedEntityId) !== "hidden").map((f) => f.fieldKey)));
    const filterSources = config.filters.filter((f) => f.fieldKey !== "__status__").map((f) => ({ source: "field" as const, fieldKey: f.fieldKey }));
    if (!assertSources([...Object.values(config.fields), ...filterSources], linkedFields, linkedEntityId) || !(await assertPageSources(Object.values(config.fields)))) {
      res.status(403).json({ error: "Mapping references a hidden linked field" }); return false;
    }
    const links = await db.select().from(recordLinksTable).where(and(eq(recordLinksTable.relationId, relation.id),
      sourceSide ? eq(recordLinksTable.sourceRecordId, recordId) : eq(recordLinksTable.targetRecordId, recordId)));
    const ids = links.map((l) => sourceSide ? l.targetRecordId : l.sourceRecordId);
    const linkedRows = ids.length ? await db.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.entityId, linkedEntityId), inArray(entityRecordsTable.id, ids))) : [];
    const linkedScope = effectiveScope(perms, linkedEntityId);
    const hiddenStatuses = effectiveStatusVisibility(perms, linkedEntityId).hiddenRowStatusIds;
    for (const linked of linkedRows) {
      if (linked.archivedAt || hiddenStatuses.includes(linked.statusId ?? -1) ||
          (linkedScope.scope === "own" && !(await isRecordOwned(linkedEntityId, linked, linkedScope.scopeFieldKeys, req.user!.userId, linkedFields)))) {
        res.status(403).json({ error: "Linked record is outside the caller's visible row scope" }); return false;
      }
      allowedLinkedRecordIds.add(linked.id);
    }
  }
  return {
    entityId: revision.entityId,
    linkedRecordIds: allowedLinkedRecordIds,
    visibility: {
      entityFields: visibleEntityFields,
      pageFields: visiblePageFields,
      formulaPermissions: await interactiveFormulaPermissions(req, revision.entityId),
    },
  };
}

router.get("/document-templates", requireAuth, requireAdmin("documentGeneration"), async (req, res): Promise<void> => {
  const parsed = ListDocumentTemplatesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const templates = await db.select().from(documentTemplatesTable)
    .where(eq(documentTemplatesTable.entityId, parsed.data.entityId))
    .orderBy(asc(documentTemplatesTable.name), asc(documentTemplatesTable.id));
  const revisions = templates.length
    ? await db.select().from(documentTemplateRevisionsTable)
        .where(inArray(documentTemplateRevisionsTable.templateId, templates.map((t) => t.id)))
        .orderBy(desc(documentTemplateRevisionsTable.revision))
    : [];
  res.json(templates.map((template) => ({ ...template, revisions: revisions.filter((r) => r.templateId === template.id) })));
});

router.get("/document-generation-runs", requireAuth, requireAdmin("documentGeneration"), async (req, res): Promise<void> => {
  const parsed = ListDocumentGenerationRunsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 50;
  const clauses = [
    parsed.data.entityId == null ? undefined : eq(documentGenerationRunsTable.entityId, parsed.data.entityId),
    parsed.data.status == null ? undefined : eq(documentGenerationRunsTable.status, parsed.data.status),
    parsed.data.templateId == null ? undefined : eq(documentTemplatesTable.id, parsed.data.templateId),
  ].filter((clause): clause is NonNullable<typeof clause> => clause != null);
  const rows = await db.select({
    run: documentGenerationRunsTable,
    templateId: documentTemplatesTable.id,
    templateName: documentTemplatesTable.name,
    revision: documentTemplateRevisionsTable.revision,
  }).from(documentGenerationRunsTable)
    .innerJoin(documentTemplateRevisionsTable, eq(documentTemplateRevisionsTable.id, documentGenerationRunsTable.revisionId))
    .innerJoin(documentTemplatesTable, eq(documentTemplatesTable.id, documentTemplateRevisionsTable.templateId))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(documentGenerationRunsTable.createdAt), desc(documentGenerationRunsTable.id))
    .limit(limit).offset((page - 1) * limit);
  res.json({
    items: rows.map(({ run, templateId, templateName, revision }) => ({
      id: run.id, revisionId: run.revisionId, templateId, revision, templateName,
      entityId: run.entityId, recordId: run.recordId, status: run.status,
      ...(presentGenerationOutput(run.outputJson) ? { output: presentGenerationOutput(run.outputJson) } : {}),
      ...(run.error ? { error: run.error } : {}),
      actorUserId: run.actorUserId, createdAt: run.createdAt, completedAt: run.completedAt,
    })),
    page, limit,
  });
});

router.post("/document-templates", requireAuth, requireAdmin("documentGeneration"), requireDocumentModule, async (req, res): Promise<void> => {
  const parsed = CreateDocumentTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entity] = await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.id, parsed.data.entityId));
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const [created] = await db.insert(documentTemplatesTable).values({
    ...parsed.data, name: parsed.data.name.trim(), createdBy: req.user!.userId,
  }).returning();
  res.status(201).json({ ...created, revisions: [] });
});

router.put("/document-templates/:id", requireAuth, requireAdmin("documentGeneration"), requireDocumentModule, async (req, res): Promise<void> => {
  const params = UpdateDocumentTemplateParams.safeParse(req.params);
  const body = UpdateDocumentTemplateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !body.success ? body.error.message : "Invalid request" });
    return;
  }
  const [updated] = await db.update(documentTemplatesTable).set({
    ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
    ...(body.data.isArchived !== undefined ? { isArchived: body.data.isArchived } : {}),
  }).where(eq(documentTemplatesTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const revisions = await db.select().from(documentTemplateRevisionsTable)
    .where(eq(documentTemplateRevisionsTable.templateId, updated.id)).orderBy(desc(documentTemplateRevisionsTable.revision));
  res.json({ ...updated, revisions });
});

router.post(
  "/document-templates/:id/revisions",
  requireAuth,
  requireAdmin("documentGeneration"),
  requireDocumentModule,
  express.raw({ type: "multipart/form-data", limit: "25mb" }),
  async (req, res): Promise<void> => {
    const params = CreateDocumentTemplateRevisionParams.safeParse(req.params);
    const upload = parseRevisionMultipart(req);
    if (!params.success || !upload || upload.file.length === 0) {
      res.status(400).json({ error: "Invalid DOCX revision request" });
      return;
    }
    const mapping = documentMappingSchema.safeParse(parseJson(upload.mapping));
    if (!mapping.success) {
      res.status(400).json({ error: "Invalid mapping configuration" });
      return;
    }
    const [template] = await db.select().from(documentTemplatesTable).where(eq(documentTemplatesTable.id, params.data.id));
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    try {
      const manifest = await parseDocxManifest(upload.file);
      const errors = await validateRevision(template.entityId, manifest, mapping.data);
      let saved: Awaited<ReturnType<typeof saveLocalFile>> | undefined;
      let revision: typeof documentTemplateRevisionsTable.$inferSelect;
      try {
        revision = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${template.id})`);
          const [max] = await tx.select({ n: sql<number>`coalesce(max(${documentTemplateRevisionsTable.revision}), 0)` })
            .from(documentTemplateRevisionsTable).where(eq(documentTemplateRevisionsTable.templateId, template.id));
          saved = await saveLocalFile("document-templates", decodeURIComponent(upload.name), DOCX_TYPE, upload.file);
          const [inserted] = await tx.insert(documentTemplateRevisionsTable).values({
            templateId: template.id, revision: Number(max?.n ?? 0) + 1, state: "draft",
            templatePath: saved.path, templateName: saved.name, manifestJson: manifest,
            mappingJson: mapping.data, errorsJson: errors, createdBy: req.user!.userId,
          }).returning();
          if (!inserted) throw new Error("Failed to create document revision");
          return inserted;
        });
      } catch (error) {
        if (saved) await deleteLocalFile(saved.path).catch((cleanupError) => req.log.error({ err: cleanupError, path: saved!.path }, "Failed to clean orphan template"));
        throw error;
      }
      res.status(201).json(revision);
    } catch (error) {
      req.log.warn({ err: error }, "Invalid document template upload");
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid DOCX" });
    }
  },
);

router.post("/document-template-revisions/:id/publish", requireAuth, requireAdmin("documentGeneration"), requireDocumentModule, async (req, res): Promise<void> => {
  const params = PublishDocumentTemplateRevisionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await isDocumentGenerationEnabled())) {
    res.status(403).json({ error: "Document generation module is disabled" });
    return;
  }
  const [draft] = await db.select({ revision: documentTemplateRevisionsTable, template: documentTemplatesTable })
    .from(documentTemplateRevisionsTable).innerJoin(documentTemplatesTable, eq(documentTemplatesTable.id, documentTemplateRevisionsTable.templateId))
    .where(eq(documentTemplateRevisionsTable.id, params.data.id));
  if (!draft || draft.revision.state !== "draft" || draft.template.isArchived) {
    res.status(404).json({ error: "Publishable draft not found" });
    return;
  }
  const errors = Array.isArray(draft.revision.errorsJson) ? draft.revision.errorsJson : ["Invalid revision errors"];
  if (errors.length) {
    res.status(409).json({ error: "Draft has incomplete or invalid mappings", details: errors });
    return;
  }
  const { id: _id, revision: _revision, state: _state, createdAt: _createdAt, ...copy } = draft.revision;
  const published = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${draft.template.id})`);
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${documentTemplateRevisionsTable.revision}), 0)` })
      .from(documentTemplateRevisionsTable).where(eq(documentTemplateRevisionsTable.templateId, draft.template.id));
    const [inserted] = await tx.insert(documentTemplateRevisionsTable).values({
      ...copy, revision: Number(max?.n ?? 0) + 1, state: "published", publishedAt: new Date(), createdBy: req.user!.userId,
    }).returning();
    if (!inserted) throw new Error("Failed to publish document revision");
    return inserted;
  });
  res.status(201).json(published);
});

router.post("/document-template-revisions/:id/test", requireAuth, requireAdmin("documentGeneration"), requireDocumentModule, async (req, res): Promise<void> => {
  const params = TestDocumentTemplateRevisionParams.safeParse(req.params);
  const body = TestDocumentTemplateRevisionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid test generation request" });
    return;
  }
  const boundary = await enforceDirectGenerationBoundary(req, res, params.data.id, body.data.recordId);
  if (boundary === false) return;
  try {
    const output = documentGenerationOutputSchema.safeParse(body.data.output);
    if (!output.success) throw new Error("Invalid output settings");
    const [target] = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, boundary.entityId), eq(entityFieldsTable.fieldKey, output.data.targetFileFieldKey), eq(entityFieldsTable.isActive, true)));
    const directPerms = await getPermissions(req);
    const directRoles = await getUserRoleIds(req);
    if (!target || resolveFieldAccess(target, directPerms, directRoles, boundary.entityId) !== "edit") throw new Error("Target file field is not writable by the caller");
    const generated = await generateDocument({ revisionId: params.data.id, recordId: body.data.recordId, actorUserId: req.user!.userId, idempotencyKey: body.data.idempotencyKey, testOnly: true, output: output.data, allowedLinkedRecordIds: boundary.linkedRecordIds, visibility: boundary.visibility });
    if (!("bytes" in generated) || !Buffer.isBuffer(generated.bytes) || typeof generated.contentType !== "string" || typeof generated.name !== "string") {
      throw new Error("Test generation did not produce a download");
    }
    res.type(generated.contentType);
    res.attachment(generated.name.replace(/[\r\n"]/g, "_"));
    res.send(generated.bytes);
  } catch (error) {
    req.log.error({ err: error }, "Document test generation failed");
    res.status(409).json({ error: error instanceof Error ? error.message : "Generation failed" });
  }
});

router.post("/document-template-revisions/:id/generate", requireAuth, requireAdmin("documentGeneration"), requireDocumentModule, async (req, res): Promise<void> => {
  const params = GenerateDocumentParams.safeParse(req.params);
  const body = GenerateDocumentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid generation request" });
    return;
  }
  const boundary = await enforceDirectGenerationBoundary(req, res, params.data.id, body.data.recordId);
  if (boundary === false) return;
  try {
    const output = documentGenerationOutputSchema.safeParse(body.data.output);
    if (!output.success) throw new Error("Invalid output settings");
    const [target] = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, boundary.entityId), eq(entityFieldsTable.fieldKey, output.data.targetFileFieldKey), eq(entityFieldsTable.isActive, true)));
    const directPerms = await getPermissions(req);
    const directRoles = await getUserRoleIds(req);
    if (!target || resolveFieldAccess(target, directPerms, directRoles, boundary.entityId) !== "edit") throw new Error("Target file field is not writable by the caller");
    res.json(await generateDocument({ revisionId: params.data.id, recordId: body.data.recordId, actorUserId: req.user!.userId, idempotencyKey: body.data.idempotencyKey, output: output.data, allowedLinkedRecordIds: boundary.linkedRecordIds, visibility: boundary.visibility }));
  } catch (error) {
    req.log.error({ err: error }, "Document generation failed");
    res.status(409).json({ error: error instanceof Error ? error.message : "Generation failed" });
  }
});

export default router;
