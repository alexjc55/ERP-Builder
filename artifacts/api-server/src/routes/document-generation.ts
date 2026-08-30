import express, { Router, type IRouter } from "express";
import {
  db,
  documentTemplatesTable,
  documentTemplateRevisionsTable,
  documentGenerationRunsTable,
  auditLogTable,
  googleDriveFoldersTable,
  entityFieldsTable,
  entitiesTable,
  entityRecordsTable,
  entityStatusesTable,
  pageFieldsTable,
  pageRecordValuesTable,
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
  DownloadDocumentTemplateRevisionParams,
  PublishDocumentTemplateRevisionParams,
  TestDocumentTemplateRevisionParams,
  TestDocumentTemplateRevisionBody,
  GenerateDocumentParams,
  GenerateDocumentBody,
  ListDocumentGenerationRunsQueryParams,
  ResolveDocumentGenerationOrphanParams,
  ResolveDocumentGenerationOrphanBody,
  ResolveDocumentGenerationOrphanResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { assertRecord, effectiveScope, effectiveStatusVisibility, getPermissions, getUserRoleIds, requireAdmin, resolveFieldAccess } from "../middlewares/permissions";
import { isRecordOwned } from "./own-scope";
import { parseDocxManifest, type DocumentManifest } from "../lib/document-docx";
import { fileFieldAllowsGdrive, generateDocument, isDocumentGenerationEnabled, lockedDocumentWriteOptions, trashPriorLocalFile } from "../lib/document-generation";
import { interactiveFormulaPermissions } from "../lib/formula-runtime";
import type { LinkedFormulaPermissionContext } from "../lib/linked-formula-resolver";
import { deleteLocalFile, readLocalFile, saveLocalFile } from "../lib/localStorage";
import { DrivePreconditionError, DriveProviderError, getAccessToken, getConnection, getDriveFileMetadata, isGoogleDriveModuleEnabled, trashDriveFile } from "../lib/googleDrive";
import { systemUpdateRecord } from "../lib/automations-engine";
import { DriveFileTombstonedError, lockGdriveFileIds } from "../lib/gdrive-file-reference-lock";

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
  const resolution = root.orphanResolution as Record<string, unknown> | undefined;
  // Recovery internals (folder, field and overwrite) are deliberately never
  // projected. Availability is a capability hint, not a trust boundary.
  if (validDriveOrphan(raw) && !resolution) out.recoveryAvailable = true;
  const safeResolutionPairs: Record<string, string> = { retry_writeback: "attached", delete_output: "deleted", mark_resolved: "acknowledged" };
  if (resolution && typeof resolution.action === "string" && safeResolutionPairs[resolution.action] === resolution.outcome &&
      typeof resolution.actorUserId === "number" && typeof resolution.resolvedAt === "string") {
    out.orphanResolution = Object.fromEntries(["action", "outcome", "actorUserId", "resolvedAt"].map((key) => [key, resolution[key]]));
  }
  if (root.cleanup && typeof root.cleanup === "object" && !Array.isArray(root.cleanup)) {
    const cleanup = root.cleanup as Record<string, unknown>;
    out.cleanup = Object.fromEntries(["attempted", "deleted", "error"].filter((key) =>
      typeof cleanup[key] === "boolean" || typeof cleanup[key] === "string").map((key) => [key, cleanup[key]]));
  }
  return Object.keys(out).length ? out : undefined;
}

type OrphanAction = "retry_writeback" | "delete_output" | "mark_resolved";
type OrphanOutcome = "attached" | "deleted" | "acknowledged";
type Recovery = { targetFileFieldKey: string; driveFolderId: string; overwrite: "replace" | "error" };
type RecoveryClaim = { action: OrphanAction; actorUserId: number; startedAt: string };
export const ORPHAN_RECOVERY_CLAIM_LEASE_MS = 5 * 60 * 1000;

export function storedOrphanRecoveryClaim(raw: unknown): RecoveryClaim | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const claim = (raw as Record<string, unknown>).orphanRecoveryClaim;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return undefined;
  const c = claim as Record<string, unknown>;
  if (!["retry_writeback", "delete_output", "mark_resolved"].includes(String(c.action)) ||
      typeof c.actorUserId !== "number" || typeof c.startedAt !== "string") return undefined;
  if (!Number.isFinite(Date.parse(c.startedAt))) return undefined;
  return c as RecoveryClaim;
}

export function activeOrphanRecoveryClaim(raw: unknown, nowMs = Date.now()): RecoveryClaim | undefined {
  const claim = storedOrphanRecoveryClaim(raw);
  if (!claim) return undefined;
  const started = Date.parse(claim.startedAt);
  if (!Number.isFinite(started) || nowMs - started >= ORPHAN_RECOVERY_CLAIM_LEASE_MS) return undefined;
  return claim;
}

export function orphanRecoveryClaimDisposition(
  raw: unknown,
  requested: OrphanAction,
  nowMs = Date.now(),
): "available" | "active_same" | "stale_same" | "different" {
  const stored = storedOrphanRecoveryClaim(raw);
  if (!stored) return "available";
  if (stored.action !== requested) return "different";
  return activeOrphanRecoveryClaim(raw, nowMs) ? "active_same" : "stale_same";
}

function withoutRecoveryClaim(output: Record<string, unknown>): Record<string, unknown> {
  const { orphanRecoveryClaim: _claim, ...rest } = output;
  return rest;
}
class OrphanResolutionError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409 = 409) { super(message); }
}

export function validDriveOrphan(raw: unknown): { file: Record<string, unknown>; recovery: Recovery; resolution?: Record<string, unknown> } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const root = raw as Record<string, unknown>;
  const file = root.file;
  const recovery = root.recovery;
  if (!file || typeof file !== "object" || Array.isArray(file) || !recovery || typeof recovery !== "object" || Array.isArray(recovery)) return undefined;
  const f = file as Record<string, unknown>, r = recovery as Record<string, unknown>;
  if (root.orphaned !== true || f.kind !== "gdrive" || typeof f.fileId !== "string" ||
      typeof r.targetFileFieldKey !== "string" || typeof r.driveFolderId !== "string" ||
      (r.overwrite !== "replace" && r.overwrite !== "error")) return undefined;
  return { file: f, recovery: r as Recovery, resolution: root.orphanResolution as Record<string, unknown> | undefined };
}

/** Exact structural reference check; no substring/JSON text matching. */
export function valueReferencesDriveFile(value: unknown, fileId: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => valueReferencesDriveFile(v, fileId));
  const obj = value as Record<string, unknown>;
  if (obj.kind === "gdrive" && obj.fileId === fileId) return true;
  return Object.values(obj).some((v) => valueReferencesDriveFile(v, fileId));
}

export function orphanTerminalResult(runId: number, resolution: Record<string, unknown>, requested: OrphanAction) {
  if (resolution.action !== requested) throw new OrphanResolutionError("A different orphan resolution has already completed");
  if (typeof resolution.outcome !== "string" || typeof resolution.actorUserId !== "number" || typeof resolution.resolvedAt !== "string") throw new OrphanResolutionError("Invalid orphan resolution");
  const expected: Record<OrphanAction, OrphanOutcome> = { retry_writeback: "attached", delete_output: "deleted", mark_resolved: "acknowledged" };
  if (resolution.outcome !== expected[requested]) throw new OrphanResolutionError("Invalid orphan resolution");
  return { runId, action: requested, outcome: resolution.outcome as OrphanOutcome, actorUserId: resolution.actorUserId, resolvedAt: resolution.resolvedAt, idempotent: true };
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

router.post("/document-generation-runs/:id/orphan-action", requireAuth, requireAdmin("documentGeneration"), requireDocumentModule, async (req, res): Promise<void> => {
  const params = ResolveDocumentGenerationOrphanParams.safeParse(req.params);
  const body = ResolveDocumentGenerationOrphanBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Invalid request" }); return; }
  const action = body.data.action as OrphanAction;
  let ownedClaim: RecoveryClaim | undefined;
  try {
    if (action === "retry_writeback") {
      const claimed = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('document_generation_orphan'), ${params.data.id})`);
        const [run] = await tx.select().from(documentGenerationRunsTable)
          .where(eq(documentGenerationRunsTable.id, params.data.id)).for("update");
        const orphan = run?.status === "error" ? validDriveOrphan(run.outputJson) : undefined;
        if (!run || !orphan) throw new OrphanResolutionError("Recoverable orphan run not found", 404);
        const [record] = await tx.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, run.recordId), eq(entityRecordsTable.entityId, run.entityId)));
        if (!record || record.archivedAt) throw new OrphanResolutionError("Target record no longer exists", 404);
        const perms = await getPermissions(req);
        if (!perms.superAdmin && perms.records[String(run.entityId)]?.update !== true) throw new OrphanResolutionError("Forbidden", 403);
        const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, run.entityId), eq(entityFieldsTable.isActive, true)));
        const scope = effectiveScope(perms, run.entityId);
        if (effectiveStatusVisibility(perms, run.entityId).hiddenRowStatusIds.includes(record.statusId ?? -1) ||
            (scope.scope === "own" && !(await isRecordOwned(run.entityId, record, scope.scopeFieldKeys, req.user!.userId, fields)))) {
          throw new OrphanResolutionError("Target record is outside the caller's visible row scope", 403);
        }
        const target = fields.find((field) => field.fieldKey === orphan.recovery.targetFileFieldKey);
        if (!target || target.fieldType !== "file" || resolveFieldAccess(target, perms, await getUserRoleIds(req), run.entityId) !== "edit" ||
            !fileFieldAllowsGdrive(target.fileConfigJson)) throw new OrphanResolutionError("Target file field is not writable for Google Drive", 403);
        if (!(await isGoogleDriveModuleEnabled())) throw new OrphanResolutionError("Google Drive module is disabled", 403);
        const [managed] = await tx.select({ id: googleDriveFoldersTable.driveFolderId }).from(googleDriveFoldersTable)
          .where(eq(googleDriveFoldersTable.driveFolderId, orphan.recovery.driveFolderId));
        if (!managed || managed.id !== orphan.recovery.driveFolderId) throw new OrphanResolutionError("Stored Drive folder is not managed");
        // Terminal replay deliberately requires no live OAuth/provider call.
        if (orphan.resolution) return { terminal: orphanTerminalResult(run.id, orphan.resolution, action), run, orphan, record };
        const claimDisposition = orphanRecoveryClaimDisposition(run.outputJson, action);
        if (claimDisposition === "different") throw new OrphanResolutionError("A different orphan recovery action is pending");
        if (claimDisposition === "active_same") throw new OrphanResolutionError("Orphan recovery is already in progress");
        ownedClaim = { action, actorUserId: req.user!.userId, startedAt: new Date().toISOString() };
        await tx.update(documentGenerationRunsTable).set({
          outputJson: { ...(run.outputJson as Record<string, unknown>), orphanRecoveryClaim: ownedClaim },
        }).where(eq(documentGenerationRunsTable.id, run.id));
        return { run, orphan, record };
      });
      if (claimed.terminal) {
        res.json(ResolveDocumentGenerationOrphanResponse.parse(claimed.terminal));
        return;
      }
      // The claim transaction is committed. These operations may open their own
      // transactions/connections without exhausting or deadlocking the pool.
      const connection = await getConnection();
      if (!connection?.refreshTokenEnc) throw new OrphanResolutionError("Google Drive is not connected", 403);
      const accessToken = await getAccessToken(connection);
      const fileId = claimed.orphan.file.fileId as string;
      const metadata = await getDriveFileMetadata(accessToken, fileId);
      if (metadata.id !== fileId || !metadata.parents.includes(claimed.orphan.recovery.driveFolderId)) throw new OrphanResolutionError("Drive file no longer matches its managed output");
      if (metadata.trashed) throw new OrphanResolutionError("Drive file is trashed");
      const [current] = await db.select({ values: entityRecordsTable.valuesJson }).from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.id, claimed.run.recordId), eq(entityRecordsTable.entityId, claimed.run.entityId)));
      const attached = valueReferencesDriveFile((current?.values as Record<string, unknown> ?? {})[claimed.orphan.recovery.targetFileFieldKey], fileId);
      if (!attached) {
        let displaced: unknown;
        const ok = await systemUpdateRecord(claimed.run.recordId, { [claimed.orphan.recovery.targetFileFieldKey]: claimed.orphan.file }, undefined, req.user!.userId, req.log,
          lockedDocumentWriteOptions({ outputFormat: "docx", destination: "gdrive", driveFolderId: claimed.orphan.recovery.driveFolderId, targetFileFieldKey: claimed.orphan.recovery.targetFileFieldKey, filenameTemplate: "recovery", overwrite: claimed.orphan.recovery.overwrite }, (v) => { displaced = v; }));
        if (!ok) throw new OrphanResolutionError("Could not write orphaned output to target file field");
        if (claimed.orphan.recovery.overwrite === "replace") await trashPriorLocalFile(claimed.run.entityId, claimed.run.recordId, claimed.orphan.recovery.targetFileFieldKey, displaced, req.user!.userId)
          .catch((trashError) => req.log.error({ err: trashError, runId: claimed.run.id }, "Failed to trash replaced recovered file"));
      }
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('document_generation_orphan'), ${claimed.run.id})`);
        const [run] = await tx.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, claimed.run.id)).for("update");
        const orphan = run && validDriveOrphan(run.outputJson);
        if (!run || !orphan) throw new OrphanResolutionError("Recoverable orphan run not found", 404);
        if (orphan.resolution) return orphanTerminalResult(run.id, orphan.resolution, action);
        const claim = (run.outputJson as Record<string, unknown>).orphanRecoveryClaim as RecoveryClaim | undefined;
        if (!ownedClaim || claim?.startedAt !== ownedClaim.startedAt || claim.actorUserId !== ownedClaim.actorUserId) throw new OrphanResolutionError("Orphan recovery claim was lost");
        const resolution = { action, outcome: "attached" as const, actorUserId: req.user!.userId, resolvedAt: new Date().toISOString() };
        await tx.update(documentGenerationRunsTable).set({
          outputJson: { ...withoutRecoveryClaim(run.outputJson as Record<string, unknown>), orphanResolution: resolution },
        }).where(eq(documentGenerationRunsTable.id, run.id));
        const done = { runId: run.id, ...resolution, idempotent: false };
        await tx.insert(auditLogTable).values({
          entityId: run.entityId,
          recordId: run.recordId,
          fieldKey: "__document_generation_orphan__",
          oldValue: null,
          newValue: JSON.stringify({ runId: done.runId, action: done.action, outcome: done.outcome }),
          userId: req.user!.userId,
        });
        return done;
      });
      res.json(ResolveDocumentGenerationOrphanResponse.parse(result));
      return;
    }
    if (action === "delete_output") {
      const claimed = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('document_generation_orphan'), ${params.data.id})`);
        const [run] = await tx.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, params.data.id)).for("update");
        const orphan = run?.status === "error" ? validDriveOrphan(run.outputJson) : undefined;
        if (!run || !orphan) throw new OrphanResolutionError("Recoverable orphan run not found", 404);
        const [record] = await tx.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, run.recordId), eq(entityRecordsTable.entityId, run.entityId)));
        if (!record || record.archivedAt) throw new OrphanResolutionError("Target record no longer exists", 404);
        const perms = await getPermissions(req);
        if (!perms.superAdmin && perms.records[String(run.entityId)]?.update !== true) throw new OrphanResolutionError("Forbidden", 403);
        const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, run.entityId), eq(entityFieldsTable.isActive, true)));
        const scope = effectiveScope(perms, run.entityId);
        if (effectiveStatusVisibility(perms, run.entityId).hiddenRowStatusIds.includes(record.statusId ?? -1) ||
            (scope.scope === "own" && !(await isRecordOwned(run.entityId, record, scope.scopeFieldKeys, req.user!.userId, fields)))) {
          throw new OrphanResolutionError("Target record is outside the caller's visible row scope", 403);
        }
        const target = fields.find((field) => field.fieldKey === orphan.recovery.targetFileFieldKey);
        if (!target || target.fieldType !== "file" || resolveFieldAccess(target, perms, await getUserRoleIds(req), run.entityId) !== "edit" ||
            !fileFieldAllowsGdrive(target.fileConfigJson)) throw new OrphanResolutionError("Target file field is not writable for Google Drive", 403);
        if (!(await isGoogleDriveModuleEnabled())) throw new OrphanResolutionError("Google Drive module is disabled", 403);
        const [managed] = await tx.select({ id: googleDriveFoldersTable.driveFolderId }).from(googleDriveFoldersTable)
          .where(eq(googleDriveFoldersTable.driveFolderId, orphan.recovery.driveFolderId));
        if (!managed || managed.id !== orphan.recovery.driveFolderId) throw new OrphanResolutionError("Stored Drive folder is not managed");
        if (orphan.resolution) return { terminal: orphanTerminalResult(run.id, orphan.resolution, action), run, orphan };
        const claimDisposition = orphanRecoveryClaimDisposition(run.outputJson, action);
        if (claimDisposition === "different") throw new OrphanResolutionError("A different orphan recovery action is pending");
        if (claimDisposition === "active_same") throw new OrphanResolutionError("Orphan recovery is already in progress");
        const fileId = orphan.file.fileId as string;
        await lockGdriveFileIds(tx, [fileId]);
        const allRecords = await tx.select({ values: entityRecordsTable.valuesJson }).from(entityRecordsTable);
        const allPages = await tx.select({ values: pageRecordValuesTable.valuesJson }).from(pageRecordValuesTable);
        if (allRecords.some((r) => valueReferencesDriveFile(r.values, fileId)) || allPages.some((r) => valueReferencesDriveFile(r.values, fileId))) {
          throw new OrphanResolutionError("Drive file is referenced by a record or page field");
        }
        ownedClaim = { action, actorUserId: req.user!.userId, startedAt: new Date().toISOString() };
        await tx.update(documentGenerationRunsTable).set({
          outputJson: { ...(run.outputJson as Record<string, unknown>), orphanRecoveryClaim: ownedClaim },
        }).where(eq(documentGenerationRunsTable.id, run.id));
        return { run, orphan };
      });
      if (claimed.terminal) {
        res.json(ResolveDocumentGenerationOrphanResponse.parse(claimed.terminal));
        return;
      }
      // No DB transaction is held across OAuth or Drive I/O. The durable claim
      // is a writer-visible tombstone until terminal finalization.
      const connection = await getConnection();
      if (!connection?.refreshTokenEnc) throw new OrphanResolutionError("Google Drive is not connected", 403);
      const accessToken = await getAccessToken(connection);
      const fileId = claimed.orphan.file.fileId as string;
      const metadata = await getDriveFileMetadata(accessToken, fileId);
      if (metadata.id !== fileId || !metadata.parents.includes(claimed.orphan.recovery.driveFolderId)) throw new OrphanResolutionError("Drive file no longer matches its managed output");
      if (!metadata.trashed) {
        const trashed = await trashDriveFile(accessToken, fileId, metadata.etag);
        if (trashed.id !== fileId || !trashed.parents.includes(claimed.orphan.recovery.driveFolderId) || !trashed.trashed) {
          throw new OrphanResolutionError("Drive trash result no longer matches its managed output");
        }
      }
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('document_generation_orphan'), ${claimed.run.id})`);
        const [run] = await tx.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, claimed.run.id)).for("update");
        const orphan = run?.status === "error" ? validDriveOrphan(run.outputJson) : undefined;
        if (!run || !orphan) throw new OrphanResolutionError("Recoverable orphan run not found", 404);
        if (orphan.resolution) return orphanTerminalResult(run.id, orphan.resolution, action);
        const claim = (run.outputJson as Record<string, unknown>).orphanRecoveryClaim as RecoveryClaim | undefined;
        if (!ownedClaim || claim?.action !== action || claim.startedAt !== ownedClaim.startedAt || claim.actorUserId !== ownedClaim.actorUserId) {
          throw new OrphanResolutionError("Orphan recovery claim was lost");
        }
        await lockGdriveFileIds(tx, [fileId]);
        const allRecords = await tx.select({ values: entityRecordsTable.valuesJson }).from(entityRecordsTable);
        const allPages = await tx.select({ values: pageRecordValuesTable.valuesJson }).from(pageRecordValuesTable);
        if (allRecords.some((r) => valueReferencesDriveFile(r.values, fileId)) || allPages.some((r) => valueReferencesDriveFile(r.values, fileId))) {
          throw new OrphanResolutionError("Drive file is referenced by a record or page field");
        }
        const resolution = { action, outcome: "deleted" as const, actorUserId: req.user!.userId, resolvedAt: new Date().toISOString() };
        await tx.update(documentGenerationRunsTable).set({
          outputJson: { ...withoutRecoveryClaim(run.outputJson as Record<string, unknown>), orphanResolution: resolution },
        }).where(eq(documentGenerationRunsTable.id, run.id));
        const done = { runId: run.id, ...resolution, idempotent: false };
        await tx.insert(auditLogTable).values({
          entityId: run.entityId,
          recordId: run.recordId,
          fieldKey: "__document_generation_orphan__",
          oldValue: null,
          newValue: JSON.stringify({ runId: done.runId, action: done.action, outcome: done.outcome }),
          userId: req.user!.userId,
        });
        return done;
      });
      res.json(ResolveDocumentGenerationOrphanResponse.parse(result));
      return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('document_generation_orphan'), ${params.data.id})`);
      const [run] = await tx.select().from(documentGenerationRunsTable)
        .where(eq(documentGenerationRunsTable.id, params.data.id)).for("update");
      if (!run || run.status !== "error") throw new OrphanResolutionError("Recoverable orphan run not found", 404);
      const orphan = validDriveOrphan(run.outputJson);
      if (!orphan) throw new OrphanResolutionError("Recoverable orphan run not found", 404);

      const [record] = await tx.select().from(entityRecordsTable).where(and(
        eq(entityRecordsTable.id, run.recordId), eq(entityRecordsTable.entityId, run.entityId),
      ));
      // Do not lock this row here: systemUpdateRecord takes its own transaction
      // and locks the current row before applying its overwrite guard. This
      // snapshot is only authorization/attachment context; the actual write is
      // protected against a concurrent field change by that locked guard.
      if (!record || record.archivedAt) throw new OrphanResolutionError("Target record no longer exists", 404);
      const perms = await getPermissions(req);
      if (!perms.superAdmin && perms.records[String(run.entityId)]?.update !== true) throw new OrphanResolutionError("Forbidden", 403);
      const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, run.entityId), eq(entityFieldsTable.isActive, true)));
      const scope = effectiveScope(perms, run.entityId);
      const hidden = effectiveStatusVisibility(perms, run.entityId).hiddenRowStatusIds;
      if (hidden.includes(record.statusId ?? -1) || (scope.scope === "own" && !(await isRecordOwned(run.entityId, record, scope.scopeFieldKeys, req.user!.userId, fields)))) {
        throw new OrphanResolutionError("Target record is outside the caller's visible row scope", 403);
      }
      const roles = await getUserRoleIds(req);
      const target = fields.find((field) => field.fieldKey === orphan.recovery.targetFileFieldKey);
      if (!target || target.fieldType !== "file" || resolveFieldAccess(target, perms, roles, run.entityId) !== "edit" ||
          !fileFieldAllowsGdrive(target.fileConfigJson)) throw new OrphanResolutionError("Target file field is not writable for Google Drive", 403);
      const [managed] = await tx.select({ id: googleDriveFoldersTable.driveFolderId }).from(googleDriveFoldersTable)
        .where(eq(googleDriveFoldersTable.driveFolderId, orphan.recovery.driveFolderId));
      if (!managed || managed.id !== orphan.recovery.driveFolderId) throw new OrphanResolutionError("Stored Drive folder is not managed");

      if (!(await isGoogleDriveModuleEnabled())) throw new OrphanResolutionError("Google Drive module is disabled", 403);
      // Replays revalidate current authorization/configuration, but have no
      // provider dependency and perform no mutation or duplicate audit.
      if (orphan.resolution) return orphanTerminalResult(run.id, orphan.resolution, action);
      const claimDisposition = orphanRecoveryClaimDisposition(run.outputJson, action);
      if (claimDisposition === "different") throw new OrphanResolutionError("A different orphan recovery action is pending");
      if (claimDisposition === "active_same") throw new OrphanResolutionError("Orphan recovery is already in progress");
      await lockGdriveFileIds(tx, [orphan.file.fileId as string]);
      const allRecords = await tx.select({ id: entityRecordsTable.id, values: entityRecordsTable.valuesJson }).from(entityRecordsTable);
      const allPages = await tx.select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson }).from(pageRecordValuesTable);
      if (allRecords.some((r) => valueReferencesDriveFile(r.values, orphan.file.fileId as string)) || allPages.some((r) => valueReferencesDriveFile(r.values, orphan.file.fileId as string))) throw new OrphanResolutionError("Drive file is referenced by a record or page field");
      const outcome: OrphanOutcome = "acknowledged";
      const resolvedAt = new Date().toISOString();
      const resolution = { action, outcome, actorUserId: req.user!.userId, resolvedAt };
      await tx.update(documentGenerationRunsTable).set({ outputJson: { ...withoutRecoveryClaim(run.outputJson as Record<string, unknown>), orphanResolution: resolution } }).where(eq(documentGenerationRunsTable.id, run.id));
      const result = { runId: run.id, ...resolution, idempotent: false };
      await tx.insert(auditLogTable).values({
        entityId: run.entityId,
        recordId: run.recordId,
        fieldKey: "__document_generation_orphan__",
        oldValue: null,
        newValue: JSON.stringify({ runId: result.runId, action: result.action, outcome: result.outcome }),
        userId: req.user!.userId,
      });
      return result;
    });
    res.json(ResolveDocumentGenerationOrphanResponse.parse(result));
  } catch (error) {
    // A delete claim is a durable tombstone: after provider work begins Drive
    // state may be uncertain, so retain it for stale-lease takeover. Retry
    // write-back has no destructive provider mutation and may clear its claim.
    if (ownedClaim?.action === "retry_writeback") {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('document_generation_orphan'), ${params.data.id})`);
        const [run] = await tx.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, params.data.id)).for("update");
        const output = run?.outputJson as Record<string, unknown> | undefined;
        const claim = output?.orphanRecoveryClaim as RecoveryClaim | undefined;
        if (run && output && claim?.startedAt === ownedClaim!.startedAt && claim.actorUserId === ownedClaim!.actorUserId) {
          await tx.update(documentGenerationRunsTable).set({ outputJson: withoutRecoveryClaim(output) }).where(eq(documentGenerationRunsTable.id, run.id));
        }
      }).catch((claimError) => req.log.error({ err: claimError, runId: params.data.id }, "Failed to clear orphan recovery claim"));
    }
    const status = error instanceof OrphanResolutionError ? error.status
      : error instanceof DrivePreconditionError || error instanceof DriveFileTombstonedError ? 409 : 502;
    // Provider/auth failures intentionally use a stable message: provider
    // response bodies and implementation details must never become an API leak.
    const baseMessage = error instanceof OrphanResolutionError ? error.message
      : error instanceof DrivePreconditionError ? "Drive file changed during orphan resolution"
        : error instanceof DriveFileTombstonedError ? "Drive file was deleted as an orphan"
        : error instanceof DriveProviderError ? "Drive provider verification failed" : "Drive provider verification failed";
    const message = ownedClaim?.action === "delete_output"
      ? `${baseMessage}. Retry after the recovery lease expires.`
      : baseMessage;
    res.status(status).json({ error: message });
  }
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

router.get("/document-template-revisions/:id/download", requireAuth, requireAdmin("documentGeneration"), async (req, res): Promise<void> => {
  const params = DownloadDocumentTemplateRevisionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [revision] = await db.select({
    templatePath: documentTemplateRevisionsTable.templatePath,
    templateName: documentTemplateRevisionsTable.templateName,
  }).from(documentTemplateRevisionsTable).where(eq(documentTemplateRevisionsTable.id, params.data.id));
  if (!revision) {
    res.status(404).json({ error: "Document revision not found" });
    return;
  }
  try {
    const bytes = await readLocalFile(revision.templatePath);
    res.type(DOCX_TYPE);
    res.attachment(revision.templateName.replace(/[\r\n"]/g, "_"));
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  } catch (error) {
    req.log.warn({ err: error, revisionId: params.data.id }, "Document template source file is unavailable");
    res.status(404).json({ error: "Template source file not found" });
  }
});

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
