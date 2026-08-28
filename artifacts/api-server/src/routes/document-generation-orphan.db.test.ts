import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  auditLogTable, db, documentGenerationRunsTable, documentTemplateRevisionsTable,
  documentTemplatesTable, entitiesTable, entityFieldsTable, entityRecordsTable,
  googleDriveFoldersTable, modulesTable, pool, rolesTable, usersTable,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import {
  DriveFileTombstonedError, lockAndValidateGdriveFileReferences,
  lockGdriveFileIds,
} from "../lib/gdrive-file-reference-lock";
import documentRouter from "./document-generation";

const label = `document-orphan-db-${randomUUID()}`;
const ids: { role?: number; user?: number; entity?: number; record?: number; template?: number; revision?: number; runs: number[]; folder?: number } = { runs: [] };
const moduleSnapshot = new Map<string, typeof modulesTable.$inferSelect | undefined>();
const snapshottedModules = new Set<string>();

function timeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 5_000);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function output(fileId: string, claim?: { action: string; startedAt: string }) {
  return {
    orphaned: true, file: { kind: "gdrive", fileId }, recovery: { targetFileFieldKey: "drive_file", driveFolderId: `${label}-folder`, overwrite: "error" },
    ...(claim ? { orphanRecoveryClaim: { ...claim, actorUserId: ids.user! } } : {}),
  };
}

async function addRun(fileId: string, claim?: { action: string; startedAt: string }, resolution?: Record<string, unknown>) {
  const [row] = await db.insert(documentGenerationRunsTable).values({
    revisionId: ids.revision!, entityId: ids.entity!, recordId: ids.record!, status: "error",
    outputJson: { ...output(fileId, claim), ...(resolution ? { orphanResolution: resolution } : {}) },
    actorUserId: ids.user!,
  }).returning({ id: documentGenerationRunsTable.id });
  ids.runs.push(row!.id);
  return row!.id;
}

async function post(runId: number) {
  const app = express();
  app.use(express.json());
  app.use("/api", documentRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}/api/document-generation-runs/${runId}/orphan-action`, {
      method: "POST", headers: { authorization: `Bearer ${signToken({ userId: ids.user!, roleId: ids.role! })}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_resolved" }),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function setup() {
  for (const key of ["document_generation", "google_drive"]) {
    const [row] = await db.select().from(modulesTable).where(eq(modulesTable.moduleKey, key));
    moduleSnapshot.set(key, row);
    snapshottedModules.add(key);
    if (row) await db.update(modulesTable).set({ isEnabled: true }).where(eq(modulesTable.id, row.id));
    else await db.insert(modulesTable).values({ moduleKey: key, nameJson: { en: key }, isEnabled: true });
  }
  const [role] = await db.insert(rolesTable).values({ nameJson: { en: label }, permissionsJson: {
    superAdmin: true, admin: { pages: true, entities: true, roles: true, users: true, translations: true, events: true, modules: true, googleDrive: true, settings: true, automations: true, customFilters: true, columnGroups: true, dataImport: true, inboundIntegrations: true, documentGeneration: true }, pageIds: [], records: {},
  } }).returning({ id: rolesTable.id });
  ids.role = role!.id;
  const [user] = await db.insert(usersTable).values({ email: `${label}@example.invalid`, firstName: label, lastName: "test", roleId: ids.role }).returning({ id: usersTable.id });
  ids.user = user!.id;
  const [entity] = await db.insert(entitiesTable).values({ entityKey: label, nameJson: { en: label } }).returning({ id: entitiesTable.id });
  ids.entity = entity!.id;
  await db.insert(entityFieldsTable).values({ entityId: ids.entity, fieldKey: "drive_file", nameJson: { en: "Drive file" }, fieldType: "file", fileConfigJson: { allowedSources: ["gdrive"], driveFolderId: `${label}-folder` } });
  const [record] = await db.insert(entityRecordsTable).values({ entityId: ids.entity, valuesJson: {} }).returning({ id: entityRecordsTable.id });
  ids.record = record!.id;
  const [folder] = await db.insert(googleDriveFoldersTable).values({ driveFolderId: `${label}-folder`, name: label }).returning({ id: googleDriveFoldersTable.id });
  ids.folder = folder!.id;
  const [template] = await db.insert(documentTemplatesTable).values({ entityId: ids.entity, name: label, createdBy: ids.user }).returning({ id: documentTemplatesTable.id });
  ids.template = template!.id;
  const [revision] = await db.insert(documentTemplateRevisionsTable).values({ templateId: ids.template, revision: 1, state: "published", templatePath: label, templateName: `${label}.docx`, createdBy: ids.user }).returning({ id: documentTemplateRevisionsTable.id });
  ids.revision = revision!.id;
}

async function cleanup(): Promise<unknown[]> {
  const errors: unknown[] = [];
  const step = async (operation: () => Promise<unknown>) => {
    try { await operation(); } catch (error) { errors.push(error); }
  };
  if (ids.entity) await step(() => db.delete(auditLogTable).where(eq(auditLogTable.entityId, ids.entity!)));
  if (ids.runs.length) await step(() => db.delete(documentGenerationRunsTable).where(inArray(documentGenerationRunsTable.id, ids.runs)));
  if (ids.template) await step(() => db.delete(documentTemplatesTable).where(eq(documentTemplatesTable.id, ids.template!)));
  if (ids.entity) await step(() => db.delete(entitiesTable).where(eq(entitiesTable.id, ids.entity!)));
  if (ids.folder) await step(() => db.delete(googleDriveFoldersTable).where(eq(googleDriveFoldersTable.id, ids.folder!)));
  if (ids.user) await step(() => db.delete(usersTable).where(eq(usersTable.id, ids.user!)));
  if (ids.role) await step(() => db.delete(rolesTable).where(eq(rolesTable.id, ids.role!)));
  for (const key of snapshottedModules) {
    const before = moduleSnapshot.get(key);
    if (before) {
      await step(() => db.update(modulesTable).set({
        nameJson: before.nameJson,
        version: before.version,
        isEnabled: before.isEnabled,
        settingsJson: before.settingsJson,
      }).where(eq(modulesTable.id, before.id)));
    } else {
      await step(() => db.delete(modulesTable).where(eq(modulesTable.moduleKey, key)));
    }
  }
  return errors;
}

after(async () => {
  const errors = await cleanup();
  try { await pool.end(); } catch (error) { errors.push(error); }
  if (errors.length > 0) throw new AggregateError(errors, "Document orphan DB test cleanup failed");
});

test("document orphan PostgreSQL locks, tombstones, and claim replays", async (t) => {
  await setup();
  await t.test("concurrent reversed transitions acquire the same canonical union without deadlock", async () => {
    const a = `${label}-a`, b = `${label}-b`;
    // Block both first-choice IDs, then release A before B. Canonical writers
    // both queue on A and complete in sequence. A reversed-order regression
    // gives one writer A and the other B, creating a real A↔B deadlock.
    const releaseA = gate(), releaseB = gate(), lockedA = gate(), lockedB = gate();
    const blockerA = db.transaction(async (tx) => {
      await lockGdriveFileIds(tx, [a]);
      lockedA.resolve();
      await releaseA.promise;
    });
    const blockerB = db.transaction(async (tx) => {
      await lockGdriveFileIds(tx, [b]);
      lockedB.resolve();
      await releaseB.promise;
    });
    await timeout(Promise.all([lockedA.promise, lockedB.promise]), "blockers did not acquire Drive locks");

    const writerPids: number[] = [];
    const writersReady = gate();
    const writer = (fileIds: string[]) => db.transaction(async (tx) => {
      const pidResult = await tx.execute(sql`SELECT pg_backend_pid() AS pid`) as { rows?: { pid: number }[] };
      writerPids.push(pidResult.rows![0]!.pid);
      if (writerPids.length === 2) writersReady.resolve();
      return lockGdriveFileIds(tx, fileIds);
    });
    const first = writer([b, a]);
    const second = writer([a, b]);
    try {
      await timeout(writersReady.promise, "writers did not start");
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await pool.query(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND pid = ANY($1::int[])",
          [writerPids],
        );
        if ((result.rows[0]?.count ?? 0) === 2) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, "writers did not wait on both blocked Drive IDs");

      releaseA.resolve();
      await timeout(blockerA, "A blocker did not commit");
      let acquiredAAndWaitingForB = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await pool.query(
          `SELECT
             count(*) FILTER (WHERE granted)::int AS granted,
             count(*) FILTER (WHERE NOT granted)::int AS waiting
           FROM pg_locks
           WHERE locktype = 'advisory' AND pid = ANY($1::int[])`,
          [writerPids],
        );
        if ((result.rows[0]?.granted ?? 0) >= 1 && (result.rows[0]?.waiting ?? 0) >= 1) {
          acquiredAAndWaitingForB = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(acquiredAAndWaitingForB, true, "writer did not acquire A before waiting for B");
      releaseB.resolve();
      await timeout(blockerB, "B blocker did not commit");
      assert.deepEqual(await timeout(Promise.all([first, second]), "Drive lock writers deadlocked"), [[a, b], [a, b]]);
    } finally {
      releaseA.resolve();
      releaseB.resolve();
      await Promise.allSettled([blockerA, blockerB, first, second]);
    }
  });

  await t.test("active delete claims and terminal deletes reject newly introduced references", async () => {
    const claimed = `${label}-claimed`, deleted = `${label}-deleted`;
    await addRun(claimed, { action: "delete_output", startedAt: new Date().toISOString() });
    await addRun(deleted, undefined, { action: "delete_output", outcome: "deleted", actorUserId: ids.user!, resolvedAt: new Date().toISOString() });
    for (const fileId of [claimed, deleted]) {
      await assert.rejects(() => db.transaction((tx) => lockAndValidateGdriveFileReferences(tx, {}, { value: { kind: "gdrive", fileId } })), (error: unknown) => error instanceof DriveFileTombstonedError && error.fileId === fileId);
    }
    await db.transaction((tx) => lockAndValidateGdriveFileReferences(tx, {}, { value: { kind: "gdrive", fileId: `${label}-safe` } }));
  });

  await t.test("mark-resolved accepts stale own claims once and rejects active or different claims", async () => {
    const stale = await addRun(`${label}-stale`, { action: "mark_resolved", startedAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    const response = await post(stale);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { outcome: string }).outcome, "acknowledged");
    const [resolved] = await db.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, stale));
    assert.equal((resolved!.outputJson as Record<string, any>).orphanResolution.outcome, "acknowledged");
    assert.equal((await db.select().from(auditLogTable).where(and(eq(auditLogTable.entityId, ids.entity!), eq(auditLogTable.recordId, ids.record!), eq(auditLogTable.fieldKey, "__document_generation_orphan__")))).length, 1);
    const different = await addRun(`${label}-different`, { action: "delete_output", startedAt: new Date(Date.now() - 6 * 60_000).toISOString() });
    const active = await addRun(`${label}-active`, { action: "mark_resolved", startedAt: new Date().toISOString() });
    for (const run of [different, active]) {
      const before = (await db.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, run)))[0]!.outputJson;
      assert.equal((await post(run)).status, 409);
      assert.deepEqual((await db.select().from(documentGenerationRunsTable).where(eq(documentGenerationRunsTable.id, run)))[0]!.outputJson, before);
    }
  });
});