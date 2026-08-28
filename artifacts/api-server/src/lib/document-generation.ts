import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  db,
  modulesTable,
  documentTemplatesTable,
  documentTemplateRevisionsTable,
  documentGenerationRunsTable,
  googleDriveFoldersTable,
  localFoldersTable,
  entityRecordsTable,
  entityFieldsTable,
  entitiesTable,
  deletedFilesTable,
  entityStatusesTable,
  pageFieldsTable,
  pageRecordValuesTable,
  relationsTable,
  recordLinksTable,
  documentMappingSchema,
  documentGenerationOutputSchema,
  DOCUMENT_GENERATION_MODULE_KEY,
  type DocumentMapping,
  type DocumentGenerationOutput,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { deleteLocalFile, readLocalFile, saveLocalFile } from "./localStorage";
import { renderDocx } from "./document-docx";
import { getAccessToken, getConnection, isGoogleDriveModuleEnabled, uploadToFolder } from "./googleDrive";
import { systemUpdateRecord } from "./automations-engine";
import { logger } from "./logger";
import { loadFormulaOptions, materializeVisibleEntityFormulas, materializeVisiblePageFormulas, mergeLinkedFormulaInputsBatched, systemFormulaPermissions } from "./formula-runtime";
import type { LinkedFormulaPermissionContext } from "./linked-formula-resolver";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_CONVERSION_BYTES = 50 * 1024 * 1024;

export function canonicalDocumentRequestKey(input: {
  callerKey?: string;
  revisionId: number;
  recordId: number;
  testOnly?: boolean;
  output: DocumentGenerationOutput;
}): string {
  const output = input.output.destination === "local"
    ? {
        outputFormat: input.output.outputFormat, destination: "local", localFolderId: input.output.localFolderId,
        targetFileFieldKey: input.output.targetFileFieldKey, filenameTemplate: input.output.filenameTemplate, overwrite: input.output.overwrite,
      }
    : {
        outputFormat: input.output.outputFormat, destination: "gdrive", driveFolderId: input.output.driveFolderId,
        targetFileFieldKey: input.output.targetFileFieldKey, filenameTemplate: input.output.filenameTemplate, overwrite: input.output.overwrite,
      };
  return createHash("sha256").update(JSON.stringify({
    callerKey: input.callerKey ?? null, revisionId: input.revisionId, recordId: input.recordId,
    mode: input.testOnly ? "test" : "live", output,
  })).digest("hex");
}

export function lockedDocumentWriteOptions(
  output: DocumentGenerationOutput,
  onDisplaced: (value: unknown) => void,
): { requireEmptyFieldKey?: string; onLockedPreviousValues: (values: Readonly<Record<string, unknown>>) => void } {
  return {
    ...(output.overwrite === "error" ? { requireEmptyFieldKey: output.targetFileFieldKey } : {}),
    onLockedPreviousValues: (values) => onDisplaced(values[output.targetFileFieldKey]),
  };
}

export async function awaitIdempotentRun<T extends { status: string; outputJson: unknown; error: string | null }>(
  load: () => Promise<T | undefined>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 50;
  const delayMs = options.delayMs ?? 100;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const run = await load();
    if (run && run.status !== "running") return run;
    await sleep(delayMs);
  }
  throw new Error("Document generation with this idempotency key is still running");
}

export async function isDocumentGenerationEnabled(): Promise<boolean> {
  const [row] = await db.select({ enabled: modulesTable.isEnabled }).from(modulesTable)
    .where(eq(modulesTable.moduleKey, DOCUMENT_GENERATION_MODULE_KEY));
  return row?.enabled === true;
}

/** Validate destination ownership and the target file field before any upload. */
export async function validateDocumentOutput(entityId: number, output: DocumentGenerationOutput): Promise<string | null> {
  const [field] = await db.select({ type: entityFieldsTable.fieldType, fileConfig: entityFieldsTable.fileConfigJson }).from(entityFieldsTable).where(and(
    eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.fieldKey, output.targetFileFieldKey), eq(entityFieldsTable.isActive, true),
  ));
  if (!field || field.type !== "file") return "targetFileFieldKey must be an active writable file field on the same entity";
  const source = output.destination === "gdrive" ? "gdrive" : "server";
  const configured = (field.fileConfig as { allowedSources?: unknown } | null)?.allowedSources;
  const allowed = Array.isArray(configured) && configured.length ? configured : ["server"];
  if (!allowed.includes(source)) return `targetFileFieldKey does not allow ${source} files`;
  if (output.destination === "gdrive") {
    const [folder] = await db.select({ id: googleDriveFoldersTable.id }).from(googleDriveFoldersTable)
      .where(eq(googleDriveFoldersTable.driveFolderId, output.driveFolderId));
    if (!folder) return "driveFolderId is not a registered managed Drive folder";
  } else {
    const [folder] = await db.select({ id: localFoldersTable.id }).from(localFoldersTable)
      .where(eq(localFoldersTable.id, output.localFolderId));
    if (!folder) return "localFolderId is not a registered managed local folder";
  }
  return null;
}

export async function trashPriorLocalFile(entityId: number, recordId: number, fieldKey: string, prior: unknown, actorUserId: number | null) {
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) return;
  const file = prior as Record<string, unknown>;
  if ((file.kind != null && file.kind !== "server") || typeof file.path !== "string" || !file.path.startsWith("/local/")) return;
  const [entity] = await db.select({ name: entitiesTable.nameJson }).from(entitiesTable).where(eq(entitiesTable.id, entityId));
  const [field] = await db.select({ name: entityFieldsTable.nameJson }).from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.fieldKey, fieldKey)));
  await db.insert(deletedFilesTable).values({
    entityId, entityNameJson: entity?.name ?? null, recordId, fieldKey, fieldNameJson: field?.name ?? null,
    fileName: typeof file.name === "string" ? file.name : path.basename(file.path),
    filePath: file.path, fileSize: typeof file.size === "number" ? file.size : null,
    contentType: typeof file.contentType === "string" ? file.contentType : null,
    reason: "field_replaced", deletedBy: actorUserId,
  });
}

/** File fields without an explicit source list retain the legacy server-only default. */
export function fileFieldAllowsGdrive(fileConfig: unknown): boolean {
  const configured = (fileConfig as { allowedSources?: unknown } | null)?.allowedSources;
  const allowed = Array.isArray(configured) && configured.length ? configured : ["server"];
  return allowed.includes("gdrive");
}

function label(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const labels = value as Record<string, unknown>;
  for (const key of ["en", "ru", "he"]) if (typeof labels[key] === "string" && labels[key]) return labels[key] as string;
  return "";
}

function mappedValue(
  mapping: DocumentMapping["scalars"][string],
  values: Record<string, unknown>,
  status: string,
  recordId: number,
  createdAt: Date,
  pages: ReadonlyMap<number, Record<string, unknown>>,
): unknown {
  switch (mapping.source) {
    case "field": return values[mapping.fieldKey];
    case "page": return pages.get(mapping.pageId)?.[mapping.fieldKey];
    case "status": return status;
    case "system": return mapping.key === "record_id" ? recordId : mapping.key === "created_at" ? createdAt.toISOString() : new Date().toISOString();
    case "literal": return mapping.value;
    case "blank": return "";
  }
}

async function materializeRows(entityId: number, rows: typeof entityRecordsTable.$inferSelect[], mapping: DocumentMapping, visibility?: {
  entityFields: ReadonlyMap<number, ReadonlySet<string>>;
  pageFields: ReadonlyMap<number, ReadonlySet<string>>;
  formulaPermissions?: LinkedFormulaPermissionContext;
}) {
  let fields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const visibleEntity = visibility?.entityFields.get(entityId);
  if (visibleEntity) fields = fields.filter((field) => visibleEntity.has(field.fieldKey));
  const baseRows = rows.map((r) => ({ id: r.id, values: { ...((r.valuesJson as Record<string, unknown>) ?? {}), ...Object.fromEntries(fields.filter((f) => f.fieldType === "created_at").map((f) => [f.fieldKey, r.createdAt.toISOString()])) } }));
  const linked = await mergeLinkedFormulaInputsBatched({ entityId, rows: baseRows, fields, permissions: visibility?.formulaPermissions ?? systemFormulaPermissions });
  const formulaOptions = await loadFormulaOptions();
  const entityValues = materializeVisibleEntityFormulas({ entityId, rows: baseRows, fields, hidden: new Set(), linkedInputs: linked, formulaOptions });
  // The authoritative linked resolver supplies relation/lookup projections for
  // formula scope. Copy only configured relation/lookup field keys into this
  // server-internal document view (never resolver tokens).
  for (const row of rows) {
    const values = entityValues.get(row.id);
    const resolved = linked.get(row.id);
    if (!values || !resolved) continue;
    for (const field of fields) {
      if ((field.fieldType === "relation" || field.fieldType === "lookup") && Object.prototype.hasOwnProperty.call(resolved, field.fieldKey)) {
        values[field.fieldKey] = resolved[field.fieldKey];
      }
    }
  }
  const pageIds = [...new Set(Object.values(mapping.scalars).concat(...Object.values(mapping.collections).map((c) => Object.values(c.fields))).filter((s) => s.source === "page").map((s) => s.pageId))];
  const pages = new Map<number, Map<number, Record<string, unknown>>>();
  for (const pageId of pageIds) {
    let pageFields = await db.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true)));
    const visiblePage = visibility?.pageFields.get(pageId);
    if (visiblePage) pageFields = pageFields.filter((field) => visiblePage.has(field.fieldKey));
    const stored = rows.length ? await db.select().from(pageRecordValuesTable).where(and(eq(pageRecordValuesTable.pageId, pageId), inArray(pageRecordValuesTable.recordId, rows.map((r) => r.id)))) : [];
    const storedByRecord = new Map(stored.map((p) => [p.recordId, (p.valuesJson as Record<string, unknown>) ?? {}]));
    pages.set(pageId, materializeVisiblePageFormulas({
      entityId, pageId, rows: rows.map((r) => ({ id: r.id, entityValues: entityValues.get(r.id) ?? {}, pageValues: storedByRecord.get(r.id) ?? {} })),
      entityFields: fields, pageFields, hiddenEntity: new Set(), hiddenPage: new Set(), linkedInputs: linked, formulaOptions,
    }));
  }
  return { entityValues, pages };
}

function collectionMatches(
  filters: DocumentMapping["collections"][string]["filters"],
  values: Record<string, unknown>,
  status: string,
): boolean {
  return filters.every((filter) => {
    const actual = filter.fieldKey === "__status__" ? status : values[filter.fieldKey];
    const text = Array.isArray(actual) ? actual.map(String).join(", ") : String(actual ?? "");
    const expected = String(filter.value ?? "");
    switch (filter.operator) {
      case "empty": return text === "";
      case "notEmpty": return text !== "";
      case "eq": return text === expected;
      case "neq": return text !== expected;
      case "contains": return text.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    }
  });
}

async function buildRenderData(
  entityId: number,
  recordId: number,
  mapping: DocumentMapping,
  allowedLinkedRecordIds?: ReadonlySet<number>,
  visibility?: { entityFields: ReadonlyMap<number, ReadonlySet<string>>; pageFields: ReadonlyMap<number, ReadonlySet<string>>; formulaPermissions?: LinkedFormulaPermissionContext },
): Promise<{ values: Record<string, unknown>; collections: Record<string, Record<string, unknown>[]> }> {
  const [record] = await db.select().from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.entityId, entityId), isNull(entityRecordsTable.archivedAt)));
  if (!record) throw new Error("Record not found");
  const materialized = await materializeRows(entityId, [record], mapping, visibility);
  const recordValues = materialized.entityValues.get(record.id) ?? {};
  const recordPages = new Map([...materialized.pages].map(([pageId, rows]) => [pageId, rows.get(record.id) ?? {}]));
  const [status] = record.statusId == null ? [] : await db.select({ name: entityStatusesTable.nameJson })
    .from(entityStatusesTable).where(eq(entityStatusesTable.id, record.statusId));
  const statusName = label(status?.name);
  const values: Record<string, unknown> = {};
  for (const [placeholder, source] of Object.entries(mapping.scalars)) {
    values[placeholder] = mappedValue(source, recordValues, statusName, record.id, record.createdAt, recordPages);
  }

  const collections: Record<string, Record<string, unknown>[]> = {};
  const relationFields = await db.select().from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  for (const [placeholder, config] of Object.entries(mapping.collections)) {
    const field = relationFields.find((f) => f.fieldKey === config.relationFieldKey);
    const relationId = field?.relationConfigJson?.relationId;
    if (!field || (field.fieldType !== "relation" && field.fieldType !== "lookup") || relationId == null) {
      collections[placeholder] = [];
      continue;
    }
    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    if (!relation) {
      collections[placeholder] = [];
      continue;
    }
    const sourceSide = relation.sourceEntityId === entityId;
    const links = await db.select().from(recordLinksTable).where(and(
      eq(recordLinksTable.relationId, relation.id),
      sourceSide ? eq(recordLinksTable.sourceRecordId, recordId) : eq(recordLinksTable.targetRecordId, recordId),
    ));
    const ids = links.map((link) => sourceSide ? link.targetRecordId : link.sourceRecordId);
    const authorizedIds = allowedLinkedRecordIds ? ids.filter((id) => allowedLinkedRecordIds.has(id)) : ids;
    const linked = authorizedIds.length ? await db.select().from(entityRecordsTable).where(and(
      eq(entityRecordsTable.entityId, sourceSide ? relation.targetEntityId : relation.sourceEntityId),
      inArray(entityRecordsTable.id, authorizedIds),
      isNull(entityRecordsTable.archivedAt),
    )) : [];
    const linkedStatuses = [...new Set(linked.map((r) => r.statusId).filter((id): id is number => id != null))];
    const statuses = linkedStatuses.length
      ? await db.select({ id: entityStatusesTable.id, name: entityStatusesTable.nameJson }).from(entityStatusesTable)
          .where(inArray(entityStatusesTable.id, linkedStatuses))
      : [];
    const statusById = new Map(statuses.map((s) => [s.id, label(s.name)]));
    const linkedEntityId = sourceSide ? relation.targetEntityId : relation.sourceEntityId;
    const materializedLinked = await materializeRows(linkedEntityId, linked, mapping, visibility);
    const rows = linked.map((row) => {
      const rv = materializedLinked.entityValues.get(row.id) ?? {};
      const rowPages = new Map([...materializedLinked.pages].map(([pageId, records]) => [pageId, records.get(row.id) ?? {}]));
      const linkedStatus = row.statusId == null ? "" : statusById.get(row.statusId) ?? "";
      if (!collectionMatches(config.filters, rv, linkedStatus)) return null;
      const out: Record<string, unknown> = {};
      for (const [key, source] of Object.entries(config.fields)) {
        out[key] = mappedValue(source, rv, row.statusId == null ? "" : statusById.get(row.statusId) ?? "", row.id, row.createdAt, rowPages);
      }
      return out;
    }).filter((row): row is Record<string, unknown> => row !== null);
    rows.sort((a, b) => {
      for (const sort of config.sort) {
        const cmp = String(a[sort.fieldKey] ?? "").localeCompare(String(b[sort.fieldKey] ?? ""), undefined, { numeric: true });
        if (cmp) return sort.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
    collections[placeholder] = rows;
  }
  return { values, collections };
}

function outputName(template: string, values: Record<string, unknown>, extension: string): string {
  const expanded = template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, (_raw, key: string) =>
    String(values[key] ?? ""));
  const base = expanded.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.(docx|pdf)$/i, "").slice(0, 160) || "document";
  return `${base}.${extension}`;
}

async function resolveExecutable(name: string): Promise<string> {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    try {
      await access(candidate, fsConstants.X_OK);
      return await realpath(candidate);
    } catch { /* continue */ }
  }
  throw new Error(`Required sandbox executable "${name}" was not found`);
}

export function libreOfficeSandboxArgs(jobDir: string, libreOfficePath: string): string[] {
  return [
    "--unshare-all", "--unshare-net", "--die-with-parent", "--new-session",
    "--ro-bind", "/nix", "/nix",
    "--ro-bind", "/etc/fonts", "/etc/fonts",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--dir", "/job", "--bind", jobDir, "/job",
    "--clearenv", "--setenv", "HOME", "/job/profile", "--setenv", "TMPDIR", "/tmp",
    "--setenv", "PATH", "/nix/var/nix/profiles/default/bin",
    "--rlimit-as", String(1024 * 1024 * 1024),
    "--rlimit-fsize", String(MAX_CONVERSION_BYTES),
    "--rlimit-nofile", "128",
    "--", libreOfficePath,
    "--headless", "--nologo", "--nodefault", "--nolockcheck",
    "-env:UserInstallation=file:///job/profile", "--convert-to", "pdf",
    "--outdir", "/job", "/job/document.docx",
  ];
}

export async function convertToPdf(
  docx: Buffer,
  dependencies: { bwrapPath?: string; libreOfficePath?: string; spawnProcess?: typeof spawn } = {},
): Promise<Buffer> {
  if (docx.length > MAX_CONVERSION_BYTES) throw new Error("PDF conversion input is too large");
  const dir = await mkdtemp(path.join(tmpdir(), "erp-document-"));
  const input = path.join(dir, "document.docx");
  try {
    await writeFile(input, docx);
    const bwrapPath = dependencies.bwrapPath ?? await resolveExecutable("bwrap");
    const libreOfficePath = dependencies.libreOfficePath ?? await resolveExecutable("libreoffice");
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      const child = (dependencies.spawnProcess ?? spawn)(bwrapPath, libreOfficeSandboxArgs(dir, libreOfficePath), {
        stdio: ["ignore", "ignore", "pipe"],
        detached: process.platform !== "win32",
        env: {},
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { if (stderr.length < 8192) stderr += String(chunk); });
      timer = setTimeout(() => {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
        finish(new Error("Sandboxed PDF conversion timed out"));
      }, 30_000);
      child.on("error", (error) => finish(new Error(`PDF sandbox failed to start: ${error.message}`)));
      child.on("exit", (code) => {
        code === 0 ? finish() : finish(new Error(`Sandboxed PDF conversion failed (${code}): ${stderr.slice(0, 500)}`));
      });
    });
    const pdf = await readFile(path.join(dir, "document.pdf"));
    if (pdf.length > MAX_CONVERSION_BYTES) throw new Error("PDF conversion output is too large");
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function generateDocument(input: {
  revisionId: number;
  recordId: number;
  actorUserId: number | null;
  idempotencyKey?: string;
  testOnly?: boolean;
  output: DocumentGenerationOutput;
  allowedLinkedRecordIds?: ReadonlySet<number>;
  visibility?: { entityFields: ReadonlyMap<number, ReadonlySet<string>>; pageFields: ReadonlyMap<number, ReadonlySet<string>>; formulaPermissions?: LinkedFormulaPermissionContext };
}): Promise<Record<string, unknown> | { bytes: Buffer; name: string; contentType: string }> {
  if (!(await isDocumentGenerationEnabled())) throw new Error("Document generation module is disabled");
  const [row] = await db.select({ revision: documentTemplateRevisionsTable, template: documentTemplatesTable })
    .from(documentTemplateRevisionsTable)
    .innerJoin(documentTemplatesTable, eq(documentTemplatesTable.id, documentTemplateRevisionsTable.templateId))
    .where(eq(documentTemplateRevisionsTable.id, input.revisionId));
  if (!row || (!input.testOnly && row.revision.state !== "published") || row.template.isArchived) throw new Error("Published document revision not found");
  const mapping = documentMappingSchema.parse(row.revision.mappingJson);
  const output = documentGenerationOutputSchema.parse(input.output);
  // Test downloads deliberately do not touch their configured destination.
  if (!input.testOnly) {
    const outputError = await validateDocumentOutput(row.template.entityId, output);
    if (outputError) throw new Error(outputError);
  }
  if (input.testOnly) {
    const data = await buildRenderData(row.template.entityId, input.recordId, mapping, input.allowedLinkedRecordIds, input.visibility);
    let bytes = await renderDocx(await readLocalFile(row.revision.templatePath), data.values, data.collections);
    let contentType = DOCX_TYPE;
    let extension = "docx";
    if (output.outputFormat === "pdf") {
      bytes = await convertToPdf(bytes);
      contentType = "application/pdf";
      extension = "pdf";
    }
    return { bytes, contentType, name: outputName(output.filenameTemplate, data.values, extension) };
  }
  const effectiveIdempotencyKey = canonicalDocumentRequestKey({
    callerKey: input.idempotencyKey,
    revisionId: input.revisionId,
    recordId: input.recordId,
    testOnly: false,
    output,
  });

  let run: typeof documentGenerationRunsTable.$inferSelect | undefined;
  let ownsRun = false;
  try {
    [run] = await db.insert(documentGenerationRunsTable).values({
      revisionId: input.revisionId,
      entityId: row.template.entityId,
      recordId: input.recordId,
      idempotencyKey: effectiveIdempotencyKey,
      status: "running",
      actorUserId: input.actorUserId,
    }).onConflictDoNothing().returning();
    ownsRun = Boolean(run);
    if (!run) {
      run = await awaitIdempotentRun(async () => {
        const [existing] = await db.select().from(documentGenerationRunsTable).where(and(
          eq(documentGenerationRunsTable.revisionId, input.revisionId),
          eq(documentGenerationRunsTable.recordId, input.recordId),
          eq(documentGenerationRunsTable.idempotencyKey, effectiveIdempotencyKey),
        ));
        return existing;
      });
      if (run?.status === "success") return (run.outputJson as Record<string, unknown>) ?? {};
      throw new Error(run?.error || "Document generation with this idempotency key failed");
    }
    const [preflight] = await db.select({ values: entityRecordsTable.valuesJson }).from(entityRecordsTable)
      .where(and(eq(entityRecordsTable.id, input.recordId), eq(entityRecordsTable.entityId, row.template.entityId)));
    if (output.overwrite === "error" &&
        (preflight?.values as Record<string, unknown> | undefined)?.[output.targetFileFieldKey] != null) {
      throw new Error("Target file field is already occupied");
    }
    const data = await buildRenderData(row.template.entityId, input.recordId, mapping, input.allowedLinkedRecordIds, input.visibility);
    let bytes = await renderDocx(await readLocalFile(row.revision.templatePath), data.values, data.collections);
    let contentType = DOCX_TYPE;
    let extension = "docx";
    if (output.outputFormat === "pdf") {
      bytes = await convertToPdf(bytes);
      contentType = "application/pdf";
      extension = "pdf";
    }
    const name = outputName(output.filenameTemplate, data.values, extension);
    let file: Record<string, unknown>;
    if (output.destination === "gdrive") {
      if (!(await isGoogleDriveModuleEnabled())) throw new Error("Google Drive module is disabled");
      const connection = await getConnection();
      if (!connection?.refreshTokenEnc) throw new Error("Google Drive is not connected");
      const [managed] = await db.select({ id: googleDriveFoldersTable.driveFolderId }).from(googleDriveFoldersTable)
        .where(eq(googleDriveFoldersTable.driveFolderId, output.driveFolderId));
      if (!managed) throw new Error("Configured Google Drive folder is not managed by the platform");
      const uploaded = await uploadToFolder(await getAccessToken(connection), managed.id, name, contentType, bytes);
      file = { kind: "gdrive", fileId: uploaded.fileId, name: uploaded.name, contentType, size: Number(uploaded.size ?? bytes.length), webViewLink: uploaded.webViewLink };
    } else {
      const [folder] = await db.select({ storageDir: localFoldersTable.storageDir }).from(localFoldersTable)
        .where(eq(localFoldersTable.id, output.localFolderId));
      if (!folder) throw new Error("Configured local folder is not managed by the platform");
      file = { kind: "server", ...(await saveLocalFile(`files/${folder.storageDir}`, name, contentType, bytes)) };
    }
    {
      let displacedFile: unknown;
      const ok = await systemUpdateRecord(
        input.recordId,
        { [output.targetFileFieldKey]: file },
        undefined,
        input.actorUserId,
        logger,
        lockedDocumentWriteOptions(output, (value) => { displacedFile = value; }),
      );
      if (!ok) {
        let cleanup: Record<string, unknown> = { attempted: false };
        if (file.kind === "server" && typeof file.path === "string") {
          try {
            await deleteLocalFile(file.path);
            cleanup = { attempted: true, deleted: true };
          } catch (cleanupError) {
            cleanup = { attempted: true, deleted: false, error: cleanupError instanceof Error ? cleanupError.message.slice(0, 500) : "cleanup failed" };
          }
        }
        // Recovery data is server-authored at upload time.  Do not reconstruct it
        // from client input when an administrator later resolves the orphan.
        if (run) await db.update(documentGenerationRunsTable).set({
          outputJson: output.destination === "gdrive"
            ? { file, orphaned: true, cleanup, recovery: { targetFileFieldKey: output.targetFileFieldKey, driveFolderId: output.driveFolderId, overwrite: output.overwrite } }
            : { file, orphaned: true, cleanup },
        })
          .where(eq(documentGenerationRunsTable.id, run.id));
        throw new Error("Generated output is orphaned: it could not be written to the configured file field");
      }
      if (output.overwrite === "replace") {
        await trashPriorLocalFile(row.template.entityId, input.recordId, output.targetFileFieldKey, displacedFile, input.actorUserId)
          .catch((trashError) => logger.error({ err: trashError, recordId: input.recordId }, "Failed to trash replaced generated file"));
      }
    }
    if (run) await db.update(documentGenerationRunsTable).set({ status: "success", outputJson: file, completedAt: new Date() })
      .where(eq(documentGenerationRunsTable.id, run.id));
    return file;
  } catch (error) {
    if (run && ownsRun) await db.update(documentGenerationRunsTable).set({
      status: "error", error: error instanceof Error ? error.message.slice(0, 2000) : "Document generation failed", completedAt: new Date(),
    }).where(eq(documentGenerationRunsTable.id, run.id)).catch((logError) => logger.error({ err: logError, runId: run!.id }, "Failed to update document run"));
    throw error;
  }
}
