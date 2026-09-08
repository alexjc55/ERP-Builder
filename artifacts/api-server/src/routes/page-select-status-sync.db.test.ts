import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogTable,
  db,
  deletedFilesTable,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  entityStatusesTable,
  entityTransitionsTable,
  pageFieldsTable,
  pageRecordValuesTable,
  pagesTable,
  rolesTable,
  systemEventsTable,
  usersTable,
  mirrorPermKey,
  type RolePermissions,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import pageFieldsRouter from "./page-fields";
import recordsRouter from "./records";

const runId = `page-select-sync-${randomUUID()}`;
const ids: Record<string, number> = {};
const app = express();
app.use(express.json());
app.use("/api", pageFieldsRouter);
app.use("/api", recordsRouter);

function permissions(
  pageIds: number[],
  hiddenStatusIds: number[] = [],
  hiddenRowStatusIds: number[] = [],
): RolePermissions {
  return {
    superAdmin: false,
    admin: {
      pages: false, entities: false, roles: false, users: false, translations: false,
      events: false, modules: false, googleDrive: false, settings: false,
      automations: false, customFilters: false, columnGroups: false, dataImport: false,
      inboundIntegrations: false, documentGeneration: false,
    },
    pageIds,
    records: {
      [String(ids.entity)]: {
        view: true, create: true, update: true, delete: true,
        ...(hiddenStatusIds.length ? { hiddenStatusIds } : {}),
        ...(hiddenRowStatusIds.length ? { hiddenRowStatusIds } : {}),
      },
    },
  };
}

async function request(
  path: string,
  body: unknown,
  method: "POST" | "PUT",
  roleId = ids.role,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${signToken({ userId: ids.user, roleId })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: Record<string, unknown>;
    if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { responseText: text, responseParseError: "Invalid JSON response" };
      }
    } else {
      parsed = { responseText: text };
    }
    return { status: response.status, body: parsed };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function pageValue(pageId: number, recordId: number) {
  const [row] = await db.select().from(pageRecordValuesTable).where(and(
    eq(pageRecordValuesTable.pageId, pageId), eq(pageRecordValuesTable.recordId, recordId),
  ));
  return row;
}

async function record(recordId: number) {
  const [row] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId));
  assert.ok(row);
  return row;
}

async function rollbackSnapshot(recordId: number) {
  const row = await record(recordId);
  const [pageRow] = await db.select().from(pageRecordValuesTable).where(and(
    eq(pageRecordValuesTable.pageId, ids.targetPage),
    eq(pageRecordValuesTable.recordId, recordId),
  ));
  const [audits, events, deletedFiles] = await Promise.all([
    db.select().from(auditLogTable).where(eq(auditLogTable.recordId, recordId)),
    db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, recordId)),
    db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, recordId)),
  ]);
  return {
    valuesJson: row.valuesJson,
    statusId: row.statusId,
    archivedAt: row.archivedAt,
    version: row.version,
    pageRow,
    audits,
    events,
    deletedFiles,
  };
}

async function pageRefRollbackSnapshot(recordId: number) {
  const row = await record(recordId);
  const [sourceRow, targetRow, audits, events, deletedFiles] = await Promise.all([
    pageValue(ids.sourcePage, recordId),
    pageValue(ids.targetPage, recordId),
    db.select().from(auditLogTable).where(eq(auditLogTable.recordId, recordId)),
    db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, recordId)),
    db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, recordId)),
  ]);
  return {
    valuesJson: row.valuesJson,
    statusId: row.statusId,
    archivedAt: row.archivedAt,
    version: row.version,
    sourceRow,
    targetRow,
    audits,
    events,
    deletedFiles,
  };
}

function assertPageRefDenialRedacted(response: { status: number; body: Record<string, unknown> }) {
  assert.equal(response.status, 403);
  const error = String(response.body.error);
  assert.ok(!error.includes(String(ids.sourcePage)), "must not expose source page id");
  assert.ok(!error.includes(`${runId} source`), "must not expose source page name");
  assert.ok(!error.includes('"stage"'), "must not expose source field key");
}

async function reset(recordIds = [ids.one, ids.two]) {
  await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
  await db.delete(auditLogTable).where(inArray(auditLogTable.recordId, recordIds));
  await db.delete(systemEventsTable).where(and(eq(systemEventsTable.entityId, ids.entity), inArray(systemEventsTable.recordId, recordIds)));
  await db.delete(deletedFilesTable).where(inArray(deletedFilesTable.recordId, recordIds));
  await db.update(entityRecordsTable).set({
    statusId: ids.base,
    archivedAt: null,
    valuesJson: {
      name: "Ready",
      owner: ids.user,
      attachment: { kind: "server", path: `/local/${runId}.txt`, name: "old.txt" },
    },
  }).where(inArray(entityRecordsTable.id, recordIds));
  await db.delete(pageRecordValuesTable).where(inArray(pageRecordValuesTable.recordId, recordIds));
}

async function setup() {
  const [entity] = await db.insert(entitiesTable).values({ entityKey: runId, nameJson: { en: runId } })
    .returning({ id: entitiesTable.id });
  ids.entity = entity!.id;
  const pages = await db.insert(pagesTable).values([
    { nameJson: { en: `${runId} target` }, mirrorEntityId: ids.entity },
    { nameJson: { en: `${runId} source` }, mirrorEntityId: ids.entity },
  ]).returning({ id: pagesTable.id });
  ids.targetPage = pages[0]!.id;
  ids.sourcePage = pages[1]!.id;
  const [role] = await db.insert(rolesTable).values({
    nameJson: { en: runId },
    permissionsJson: permissions([ids.targetPage, ids.sourcePage]),
  }).returning({ id: rolesTable.id });
  ids.role = role!.id;
  const [user] = await db.insert(usersTable).values({
    email: `${runId}@example.invalid`, firstName: "Page", lastName: "Writer", roleId: ids.role,
  }).returning({ id: usersTable.id });
  ids.user = user!.id;
  await db.insert(entityFieldsTable).values([
    { entityId: ids.entity, fieldKey: "name", nameJson: { en: "Name" }, fieldType: "text", isRequired: true },
    { entityId: ids.entity, fieldKey: "owner", nameJson: { en: "Owner" }, fieldType: "user" },
    { entityId: ids.entity, fieldKey: "attachment", nameJson: { en: "Attachment" }, fieldType: "file" },
    { entityId: ids.entity, fieldKey: "workflow_note", nameJson: { en: "Workflow note" }, fieldType: "text" },
  ]);
  const statuses = await db.insert(entityStatusesTable).values([
    { entityId: ids.entity, statusKey: "base", nameJson: { en: "Base" }, isDefault: true, sortOrder: 0 },
    { entityId: ids.entity, statusKey: "done", nameJson: { en: "Done" }, sortOrder: 1 },
    { entityId: ids.entity, statusKey: "archive", nameJson: { en: "Archive" }, isArchiveTrigger: true, archiveAfterDays: 0, sortOrder: 2 },
  ]).returning({ id: entityStatusesTable.id, statusKey: entityStatusesTable.statusKey });
  for (const status of statuses) ids[status.statusKey] = status.id;
  await db.insert(entityFieldsTable).values({
    entityId: ids.entity,
    fieldKey: "mapped_stage",
    nameJson: { en: "Mapped stage" },
    fieldType: "select",
    optionsJson: [{ value: "done", labelJson: { en: "Done" }, statusId: ids.done }],
  });
  await db.insert(pageFieldsTable).values([
    {
      pageId: ids.targetPage, fieldKey: "stage", nameJson: { en: "Stage" }, fieldType: "select",
      optionsJson: [{ value: "done", labelJson: { en: "Done" }, statusId: ids.done }, { value: "archive", labelJson: { en: "Archive" }, statusId: ids.archive }],
    },
    {
      pageId: ids.targetPage, fieldKey: "source_stage", nameJson: { en: "Source stage" }, fieldType: "page_ref",
      pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "stage" },
    },
    {
      pageId: ids.sourcePage, fieldKey: "stage", nameJson: { en: "Stage" }, fieldType: "select",
      optionsJson: [{ value: "done", labelJson: { en: "Done" }, statusId: ids.done }],
    },
  ]);
  const records = await db.insert(entityRecordsTable).values([
    { entityId: ids.entity, valuesJson: { name: "Ready", owner: ids.user, attachment: { kind: "server", path: `/local/${runId}.txt`, name: "old.txt" } }, statusId: ids.base },
    { entityId: ids.entity, valuesJson: { name: "Ready", owner: ids.user, attachment: { kind: "server", path: `/local/${runId}-2.txt`, name: "old2.txt" } }, statusId: ids.base },
  ]).returning({ id: entityRecordsTable.id });
  ids.one = records[0]!.id; ids.two = records[1]!.id;
}

async function cleanup() {
  if (ids.entity) {
    await db.delete(systemEventsTable).where(eq(systemEventsTable.entityId, ids.entity));
    await db.delete(auditLogTable).where(eq(auditLogTable.entityId, ids.entity));
    await db.delete(deletedFilesTable).where(eq(deletedFilesTable.entityId, ids.entity));
  }
  if (ids.targetPage || ids.sourcePage) await db.delete(pagesTable).where(inArray(pagesTable.id, [ids.targetPage, ids.sourcePage]));
  if (ids.entity) await db.delete(entitiesTable).where(eq(entitiesTable.id, ids.entity));
  if (ids.user) await db.delete(usersTable).where(eq(usersTable.id, ids.user));
  if (ids.role) await db.delete(rolesTable).where(eq(rolesTable.id, ids.role));
}

after(async () => { await cleanup(); });

test("page-local select mappings synchronize entity status atomically", async (t) => {
  await setup();
  await t.test("single and bulk writes commit page values and mapped statuses", async () => {
    let response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "done" } }, "PUT");
    assert.equal(response.status, 200);
    assert.equal((await record(ids.one)).statusId, ids.done);
    assert.equal(((await pageValue(ids.targetPage, ids.one))!.valuesJson as Record<string, unknown>).stage, "done");
    await reset();
    response = await request(`/pages/${ids.targetPage}/records/bulk-field-values`, { fieldKey: "stage", value: "done", recordIds: [ids.one, ids.two] }, "POST");
    assert.equal(response.status, 200);
    assert.deepEqual((response.body.updatedIds as number[]).sort(), [ids.one, ids.two].sort());
    assert.equal((await record(ids.one)).statusId, ids.done);
    assert.equal((await record(ids.two)).statusId, ids.done);
    assert.equal(((await pageValue(ids.targetPage, ids.one))!.valuesJson as Record<string, unknown>).stage, "done");
    assert.equal(((await pageValue(ids.targetPage, ids.two))!.valuesJson as Record<string, unknown>).stage, "done");
  });

  await t.test("page_ref writes only its authoritative source and source access denial has no side effects", async () => {
    await reset([ids.one]);
    let response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { source_stage: "done" } }, "PUT");
    assert.equal(response.status, 200);
    assert.equal(((await pageValue(ids.sourcePage, ids.one))!.valuesJson as Record<string, unknown>).stage, "done");
    assert.equal(await pageValue(ids.targetPage, ids.one), undefined);
    assert.equal((await record(ids.one)).statusId, ids.done);
    await reset([ids.one]);
    const beforeDenied = await pageRefRollbackSnapshot(ids.one);
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage]) }).where(eq(rolesTable.id, ids.role));
    response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { source_stage: "done" } }, "PUT");
    assertPageRefDenialRedacted(response);
    assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeDenied);
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) }).where(eq(rolesTable.id, ids.role));
  });

  await t.test("bulk page_ref writes use only the source page and deny atomically without source access", async () => {
    await reset();
    let response = await request(
      `/pages/${ids.targetPage}/records/bulk-field-values`,
      { fieldKey: "source_stage", value: "done", recordIds: [ids.one, ids.two] },
      "POST",
    );
    assert.equal(response.status, 200);
    for (const recordId of [ids.one, ids.two]) {
      assert.equal(((await pageValue(ids.sourcePage, recordId))!.valuesJson as Record<string, unknown>).stage, "done");
      assert.equal(await pageValue(ids.targetPage, recordId), undefined);
      assert.equal((await record(recordId)).statusId, ids.done);
    }

    await reset();
    const beforeDenied = await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]);
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage]) }).where(eq(rolesTable.id, ids.role));
    response = await request(
      `/pages/${ids.targetPage}/records/bulk-field-values`,
      { fieldKey: "source_stage", value: "done", recordIds: [ids.one, ids.two] },
      "POST",
    );
    assert.equal(response.status, 403);
    assertPageRefDenialRedacted(response);
    assert.deepEqual(
      await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]),
      beforeDenied,
    );
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) }).where(eq(rolesTable.id, ids.role));
  });

  await t.test("page_ref source field permissions deny single writes without side effects", async () => {
    for (const access of ["hidden", "view"] as const) {
      await reset([ids.one]);
      const beforeDenied = await pageRefRollbackSnapshot(ids.one);
      await db.update(pageFieldsTable).set({
        permissionsJson: { [String(ids.role)]: access },
      }).where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      try {
        const response = await request(
          `/pages/${ids.targetPage}/records/${ids.one}/values`,
          { valuesJson: { source_stage: "done" } },
          "PUT",
        );
        assert.equal(response.status, 403, `${access} source field must deny page_ref writes`);
        assertPageRefDenialRedacted(response);
        assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeDenied);
      } finally {
        await db.update(pageFieldsTable).set({ permissionsJson: {} })
          .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      }
    }
  });

  await t.test("page_ref source field permissions deny bulk writes atomically without side effects", async () => {
    for (const access of ["hidden", "view"] as const) {
      await reset();
      const beforeDenied = await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]);
      await db.update(pageFieldsTable).set({
        permissionsJson: { [String(ids.role)]: access },
      }).where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      try {
        const response = await request(
          `/pages/${ids.targetPage}/records/bulk-field-values`,
          { fieldKey: "source_stage", value: "done", recordIds: [ids.one, ids.two] },
          "POST",
        );
        assert.equal(response.status, 403, `${access} source field must deny bulk page_ref writes`);
        assertPageRefDenialRedacted(response);
        assert.deepEqual(
          await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]),
          beforeDenied,
        );
      } finally {
        await db.update(pageFieldsTable).set({ permissionsJson: {} })
          .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      }
    }
  });

  await t.test("page_ref target alias permissions deny single and bulk writes without leaking the source", async () => {
    for (const access of ["hidden", "view"] as const) {
      for (const mode of ["single", "bulk"] as const) {
        await reset();
        const recordIds = mode === "single" ? [ids.one] : [ids.one, ids.two];
        const beforeDenied = await Promise.all(recordIds.map(pageRefRollbackSnapshot));
        await db.update(pageFieldsTable).set({
          permissionsJson: { [String(ids.role)]: access },
          ...(mode === "single"
            ? { pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "stale_source_key" } }
            : {}),
        }).where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        try {
          const response = mode === "single"
            ? await request(
                `/pages/${ids.targetPage}/records/${ids.one}/values`,
                { valuesJson: { source_stage: "done" } },
                "PUT",
              )
            : await request(
                `/pages/${ids.targetPage}/records/bulk-field-values`,
                { fieldKey: "source_stage", value: "done", recordIds },
                "POST",
              );
          assertPageRefDenialRedacted(response);
          assert.deepEqual(
            await Promise.all(recordIds.map(pageRefRollbackSnapshot)),
            beforeDenied,
            `${access} target alias ${mode} denial must have no side effects`,
          );
        } finally {
          await db.update(pageFieldsTable).set({
            permissionsJson: {},
            pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "stage" },
          })
            .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        }
      }
    }
  });

  await t.test("page_ref no-ops require every source and target permission in single and bulk", async () => {
    const cases: Array<{
      name: string;
      expectedStatus?: number;
      apply: () => Promise<void>;
      restore: () => Promise<void>;
    }> = [
      ...(["hidden", "view"] as const).map((access) => ({
        name: `${access} target alias`,
        apply: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: { [String(ids.role)]: access } })
            .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        },
        restore: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: {} })
            .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        },
      })),
      ...(["hidden", "view"] as const).map((access) => ({
        name: `${access} source field`,
        apply: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: { [String(ids.role)]: access } })
            .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
        },
        restore: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: {} })
            .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
        },
      })),
      {
        name: "hidden source page",
        apply: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage]) })
            .where(eq(rolesTable.id, ids.role));
        },
        restore: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
            .where(eq(rolesTable.id, ids.role));
        },
      },
      {
        name: "read-only source records",
        apply: async () => {
          const denied = permissions([ids.targetPage, ids.sourcePage]);
          denied.records[mirrorPermKey(ids.sourcePage)] = {
            view: true, create: false, update: false, delete: false,
          };
          await db.update(rolesTable).set({ permissionsJson: denied }).where(eq(rolesTable.id, ids.role));
        },
        restore: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
            .where(eq(rolesTable.id, ids.role));
        },
      },
      {
        name: "hidden source status",
        expectedStatus: 404,
        apply: async () => {
          await db.update(rolesTable).set({
            permissionsJson: permissions([ids.targetPage, ids.sourcePage], [], [ids.done]),
          }).where(eq(rolesTable.id, ids.role));
        },
        restore: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
            .where(eq(rolesTable.id, ids.role));
        },
      },
    ];

    for (const permissionCase of cases) {
      for (const mode of ["single", "bulk"] as const) {
        await reset();
        const recordIds = mode === "single" ? [ids.one] : [ids.one, ids.two];
        const seed = await request(
          `/pages/${ids.targetPage}/records/bulk-field-values`,
          { fieldKey: "source_stage", value: "done", recordIds },
          "POST",
        );
        assert.equal(seed.status, 200);
        const beforeDenied = await Promise.all(recordIds.map(pageRefRollbackSnapshot));
        await permissionCase.apply();
        try {
          const response = mode === "single"
            ? await request(
                `/pages/${ids.targetPage}/records/${ids.one}/values`,
                { valuesJson: { source_stage: "done" } },
                "PUT",
              )
            : await request(
                `/pages/${ids.targetPage}/records/bulk-field-values`,
                { fieldKey: "source_stage", value: "done", recordIds },
                "POST",
              );
          if (permissionCase.expectedStatus === 404) {
            assert.equal(response.status, 404);
            assert.ok(!String(response.body.error).includes("source page"));
          } else {
            assertPageRefDenialRedacted(response);
          }
          assert.deepEqual(
            await Promise.all(recordIds.map(pageRefRollbackSnapshot)),
            beforeDenied,
            `${permissionCase.name} ${mode} no-op denial must preserve the full rollback snapshot`,
          );
        } finally {
          await permissionCase.restore();
        }
      }
    }
  });

  await t.test("page_ref source own-scope denies changed and no-op single writes without side effects", async () => {
    for (const mode of ["changed", "no-op"] as const) {
      await reset([ids.one]);
      if (mode === "no-op") {
        const seed = await request(
          `/pages/${ids.targetPage}/records/${ids.one}/values`,
          { valuesJson: { source_stage: "done" } },
          "PUT",
        );
        assert.equal(seed.status, 200);
      }
      await db.update(entityRecordsTable).set({
        valuesJson: { name: "Ready", owner: 0 },
      }).where(eq(entityRecordsTable.id, ids.one));
      const sourceOwn = permissions([ids.targetPage, ids.sourcePage]);
      sourceOwn.records[mirrorPermKey(ids.sourcePage)] = {
        view: true, create: false, update: true, delete: false, scope: "own", scopeFieldKeys: ["owner"],
      };
      await db.update(rolesTable).set({ permissionsJson: sourceOwn }).where(eq(rolesTable.id, ids.role));
      const beforeDenied = await pageRefRollbackSnapshot(ids.one);
      try {
        const response = await request(
          `/pages/${ids.targetPage}/records/${ids.one}/values`,
          { valuesJson: { source_stage: "done" } },
          "PUT",
        );
        assert.equal(response.status, 404, `${mode} source-own denial must hide the record`);
        assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeDenied);
      } finally {
        await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
          .where(eq(rolesTable.id, ids.role));
      }
    }
  });

  await t.test("single page_ref rechecks source own-scope after locking the entity record", async () => {
    await reset([ids.one]);
    const sourceOwn = permissions([ids.targetPage, ids.sourcePage]);
    sourceOwn.records[mirrorPermKey(ids.sourcePage)] = {
      view: true, create: false, update: true, delete: false, scope: "own", scopeFieldKeys: ["owner"],
    };
    await db.update(rolesTable).set({ permissionsJson: sourceOwn }).where(eq(rolesTable.id, ids.role));
    let releaseLock: (() => void) | undefined;
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    let lockReadyResolve: (() => void) | undefined;
    const lockReady = new Promise<void>((resolve) => { lockReadyResolve = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: entityRecordsTable.id }).from(entityRecordsTable)
        .where(eq(entityRecordsTable.id, ids.one)).for("update");
      await tx.update(entityRecordsTable).set({ valuesJson: { name: "Ready", owner: 0 } })
        .where(eq(entityRecordsTable.id, ids.one));
      lockReadyResolve!();
      await release;
    });
    try {
      await lockReady;
      const responsePromise = request(
        `/pages/${ids.targetPage}/records/${ids.one}/values`,
        { valuesJson: { source_stage: "done" } },
        "PUT",
      );
      // The request's unlocked preflight observes the still-committed owner,
      // then waits on this lock; release on a bounded timer to avoid a hung test.
      await new Promise((resolve) => setTimeout(resolve, 75));
      releaseLock!();
      await holder;
      const beforeResponseEffects = await pageRefRollbackSnapshot(ids.one);
      const response = await responsePromise;
      assert.equal(response.status, 404);
      assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeResponseEffects);
    } finally {
      releaseLock?.();
      await holder.catch(() => undefined);
      await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
        .where(eq(rolesTable.id, ids.role));
    }
  });

  await t.test("workflow, required-field failures roll back page/status/version/audit/event state", async () => {
    await reset([ids.one]);
    const beforeGraphFailure = await rollbackSnapshot(ids.one);
    await db.insert(entityTransitionsTable).values({ entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive, nameJson: {}, allowedRoleIds: [], requiredFieldKeys: [], actionsJson: [] });
    let response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "done" } }, "PUT");
    assert.equal(response.status, 422);
    assert.deepEqual(await rollbackSnapshot(ids.one), beforeGraphFailure);
    await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
    await db.insert(entityTransitionsTable).values({ entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done, nameJson: {}, allowedRoleIds: [], requiredFieldKeys: ["name"], actionsJson: [] });
    await db.update(entityRecordsTable).set({ valuesJson: { attachment: { kind: "server", path: `/local/${runId}.txt`, name: "old.txt" } } }).where(eq(entityRecordsTable.id, ids.one));
    const beforeRequiredFailure = await rollbackSnapshot(ids.one);
    response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "done" } }, "PUT");
    assert.equal(response.status, 400);
    assert.deepEqual(await rollbackSnapshot(ids.one), beforeRequiredFailure);
  });

  await t.test("mapped statuses bypass picker/manual/role policy but enforce graph, actions and archive effects", async () => {
    await reset([ids.one]);
    await db.update(entitiesTable).set({ statusManualEditPolicy: "disabled_all" }).where(eq(entitiesTable.id, ids.entity));
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage], [ids.archive]) }).where(eq(rolesTable.id, ids.role));
    await db.insert(entityTransitionsTable).values({ entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive, nameJson: {}, allowedRoleIds: [999999], requiredFieldKeys: ["name"], actionsJson: [{ type: "set_field", fieldKey: "attachment", value: null }] });
    const response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "archive" } }, "PUT");
    assert.equal(response.status, 200);
    const updated = await record(ids.one);
    assert.equal(updated.statusId, ids.archive);
    assert.ok(updated.archivedAt);
    assert.equal((updated.valuesJson as Record<string, unknown>).attachment, undefined);
    const audits = await db.select({ fieldKey: auditLogTable.fieldKey }).from(auditLogTable).where(eq(auditLogTable.recordId, ids.one));
    assert.ok(audits.some((row) => row.fieldKey === "__status__"));
    assert.ok(audits.some((row) => row.fieldKey === "__archived__"));
    const events = await db.select({ eventName: systemEventsTable.eventName, payload: systemEventsTable.payloadJson }).from(systemEventsTable).where(eq(systemEventsTable.recordId, ids.one));
    assert.ok(events.some((row) => row.eventName === "record.updated" && (row.payload as Record<string, unknown>).changedFields instanceof Array && ((row.payload as Record<string, unknown>).changedFields as string[]).includes("__archived__")));
    assert.ok(events.some((row) => row.eventName === "status.changed"));
    const [deleted] = await db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, ids.one));
    assert.equal(deleted!.filePath, `/local/${runId}.txt`);
  });

  await t.test("records PUT resolves matching mapped statuses after CAS and enforces their workflow atomically", async () => {
    try {
      await db.update(entitiesTable).set({ statusManualEditPolicy: "disabled_all" })
        .where(eq(entitiesTable.id, ids.entity));
      await db.update(rolesTable).set({
        permissionsJson: permissions([ids.targetPage, ids.sourcePage], [ids.done]),
      }).where(eq(rolesTable.id, ids.role));

      // The stale version must win before mapping can reach either manual-policy
      // or workflow validation.
      await reset([ids.one]);
      const staleVersion = (await record(ids.one)).version;
      let response = await request(
        `/records/${ids.one}`,
        { valuesJson: { workflow_note: "advance version" }, expectedVersion: staleVersion },
        "PUT",
      );
      assert.equal(response.status, 200);
      const advancedVersion = (await record(ids.one)).version;
      assert.ok(advancedVersion > staleVersion);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive,
        nameJson: {}, allowedRoleIds: [], requiredFieldKeys: [], actionsJson: [],
      });
      const beforeCasFailure = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { mapped_stage: "done" }, statusId: ids.done, expectedVersion: staleVersion },
        "PUT",
      );
      assert.equal(response.status, 409);
      assert.equal(response.body.currentVersion, advancedVersion);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeCasFailure);

      // A mapped write bypasses the hidden picker, manual-policy and transition
      // role restrictions, but still runs its matching graph transition/actions.
      await reset([ids.one]);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done,
        nameJson: {}, allowedRoleIds: [999999], requiredFieldKeys: ["name"],
        actionsJson: [{ type: "set_field", fieldKey: "attachment", value: null }],
      });
      const beforeSuccess = await record(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { mapped_stage: "done" }, statusId: ids.done, expectedVersion: beforeSuccess.version },
        "PUT",
      );
      assert.equal(response.status, 200);
      const mapped = await record(ids.one);
      assert.equal(mapped.statusId, ids.done);
      assert.equal(mapped.archivedAt, null);
      assert.equal(mapped.version, beforeSuccess.version + 1);
      assert.equal((mapped.valuesJson as Record<string, unknown>).mapped_stage, "done");
      assert.equal((mapped.valuesJson as Record<string, unknown>).attachment, undefined);
      const [audits, events, deletedFiles] = await Promise.all([
        db.select({ fieldKey: auditLogTable.fieldKey }).from(auditLogTable)
          .where(eq(auditLogTable.recordId, ids.one)),
        db.select({ eventName: systemEventsTable.eventName, payload: systemEventsTable.payloadJson })
          .from(systemEventsTable).where(eq(systemEventsTable.recordId, ids.one)),
        db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, ids.one)),
      ]);
      for (const fieldKey of ["mapped_stage", "attachment", "__status__"]) {
        assert.ok(audits.some((row) => row.fieldKey === fieldKey), `missing ${fieldKey} audit`);
      }
      assert.ok(!audits.some((row) => row.fieldKey === "__archived__"));
      assert.ok(events.some((row) =>
        row.eventName === "record.updated" &&
        ["mapped_stage", "attachment"].every((fieldKey) =>
          ((row.payload as Record<string, unknown>).changedFields as string[]).includes(fieldKey),
        ),
      ));
      assert.ok(events.some((row) => row.eventName === "status.changed"));
      assert.equal(deletedFiles.length, 1);
      assert.equal(deletedFiles[0]!.filePath, `/local/${runId}.txt`);

      // A configured graph without the mapped edge still rejects the write.
      await reset([ids.one]);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive,
        nameJson: {}, allowedRoleIds: [], requiredFieldKeys: [], actionsJson: [],
      });
      const beforeGraphFailure = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`, { valuesJson: { mapped_stage: "done" }, statusId: ids.done }, "PUT",
      );
      assert.equal(response.status, 422);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeGraphFailure);

      // workflow_note is optional at the entity level, so this is specifically
      // the transition's required-field check rather than normal validation.
      await reset([ids.one]);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done,
        nameJson: {}, allowedRoleIds: [], requiredFieldKeys: ["workflow_note"], actionsJson: [],
      });
      const beforeRequiredFailure = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`, { valuesJson: { mapped_stage: "done" }, statusId: ids.done }, "PUT",
      );
      assert.equal(response.status, 422);
      assert.match(String(response.body.error), /Fields required for this transition: workflow_note/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeRequiredFailure);

      await reset([ids.one]);
      const beforeConflict = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { mapped_stage: "done" }, statusId: ids.archive },
        "PUT",
      );
      assert.equal(response.status, 422);
      assert.match(String(response.body.error), /conflicts with the explicitly selected system status/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeConflict);

      const beforeManualRejection = await rollbackSnapshot(ids.one);
      response = await request(`/records/${ids.one}`, { statusId: ids.archive }, "PUT");
      assert.equal(response.status, 403);
      assert.match(String(response.body.error), /Manual status editing is disabled/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeManualRejection);

      // Supplying valuesJson is not itself a mapped write. Without an actual
      // mapped-select change, ordinary picker and transition-role checks apply.
      await reset([ids.one]);
      await db.update(entitiesTable).set({ statusManualEditPolicy: "allowed" })
        .where(eq(entitiesTable.id, ids.entity));
      const beforeHiddenRejection = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { name: "Ready" }, statusId: ids.done },
        "PUT",
      );
      assert.equal(response.status, 403);
      assert.match(String(response.body.error), /status is not available to your role/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeHiddenRejection);

      await reset([ids.one]);
      await db.update(rolesTable).set({
        permissionsJson: permissions([ids.targetPage, ids.sourcePage]),
      }).where(eq(rolesTable.id, ids.role));
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done,
        nameJson: {}, allowedRoleIds: [999999], requiredFieldKeys: [], actionsJson: [],
      });
      const beforeRoleRejection = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { name: "Ready" }, statusId: ids.done },
        "PUT",
      );
      assert.equal(response.status, 403);
      assert.match(String(response.body.error), /role is not allowed to perform this transition/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeRoleRejection);
    } finally {
      await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
      await db.update(entitiesTable).set({ statusManualEditPolicy: "allowed" })
        .where(eq(entitiesTable.id, ids.entity));
      await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
        .where(eq(rolesTable.id, ids.role));
      await reset([ids.one]);
    }
  });

  await t.test("bulk archive mapping applies actions and emits complete effects for every record", async () => {
    await reset();
    await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
    await db.insert(entityTransitionsTable).values({
      entityId: ids.entity,
      fromStatusId: ids.base,
      toStatusId: ids.archive,
      nameJson: {},
      allowedRoleIds: [999999],
      requiredFieldKeys: ["name"],
      actionsJson: [{ type: "set_field", fieldKey: "attachment", value: null }],
    });
    const response = await request(
      `/pages/${ids.targetPage}/records/bulk-field-values`,
      { fieldKey: "stage", value: "archive", recordIds: [ids.one, ids.two] },
      "POST",
    );
    assert.equal(response.status, 200);
    for (const recordId of [ids.one, ids.two]) {
      const updated = await record(recordId);
      assert.equal(((await pageValue(ids.targetPage, recordId))!.valuesJson as Record<string, unknown>).stage, "archive");
      assert.equal(updated.statusId, ids.archive);
      assert.ok(updated.archivedAt);
      assert.equal((updated.valuesJson as Record<string, unknown>).attachment, undefined);
      const [audits, events, deleted] = await Promise.all([
        db.select({ fieldKey: auditLogTable.fieldKey }).from(auditLogTable).where(eq(auditLogTable.recordId, recordId)),
        db.select({ eventName: systemEventsTable.eventName, payload: systemEventsTable.payloadJson }).from(systemEventsTable).where(eq(systemEventsTable.recordId, recordId)),
        db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, recordId)),
      ]);
      assert.ok(audits.some((row) => row.fieldKey === "__status__"));
      assert.ok(audits.some((row) => row.fieldKey === "__archived__"));
      assert.ok(events.some((row) =>
        row.eventName === "record.updated" &&
        ((row.payload as Record<string, unknown>).changedFields as string[]).includes("__archived__"),
      ));
      assert.ok(events.some((row) => row.eventName === "status.changed"));
      assert.equal(deleted.length, 1);
      assert.equal(deleted[0]!.reason, "field_cleared");
    }
  });
});