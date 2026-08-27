import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  entityStatusesTable,
  pool,
  rolesTable,
  systemEventsTable,
  usersTable,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import importRouter from "./import";

const runId = `import-status-${randomUUID()}`;
const ids: {
  role?: number;
  blockedUser?: number;
  allowedUser?: number;
  entity?: number;
  defaultStatus?: number;
  explicitStatus?: number;
  existingRecord?: number;
} = {};

type ImportResponse = {
  ok: boolean;
  files: Array<{
    created: number;
    updated: number;
    errors: number;
    rows: Array<{ index: number; status: string; message: string | null }>;
  }>;
};

const app = express();
app.use(express.json());
app.use("/api", importRouter);

async function postImport(
  endpoint: "preview" | "commit",
  userId: number,
  rows: Array<{ index: number; values: Record<string, unknown>; statusName?: string | null }>,
): Promise<ImportResponse> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/import/${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signToken({ userId, roleId: ids.role! })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        files: [{
          kind: "entity",
          entityId: ids.entity,
          keyFieldKey: "external_key",
          rows,
        }],
      }),
    });
    assert.equal(response.status, 200);
    return await response.json() as ImportResponse;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

async function setPolicy(policy: "disabled_all" | "disabled_users", userIds: number[] = []) {
  await db.update(entitiesTable).set({
    statusManualEditPolicy: policy,
    statusManualEditUserIds: userIds,
  }).where(eq(entitiesTable.id, ids.entity!));
}

async function resetExistingRecord() {
  await db.update(entityRecordsTable).set({
    valuesJson: { external_key: `${runId}:existing`, name: "Before import" },
    statusId: ids.defaultStatus,
  }).where(eq(entityRecordsTable.id, ids.existingRecord!));
}

function rows(
  suffix: string,
  createStatus: string | null | undefined,
  updateStatus: string | null | undefined,
) {
  const create = {
    index: 2,
    values: { external_key: `${runId}:${suffix}`, name: "Created by import" },
    ...(createStatus !== undefined ? { statusName: createStatus } : {}),
  };
  const update = {
    index: 3,
    values: { external_key: `${runId}:existing`, name: "Updated by import" },
    ...(updateStatus !== undefined ? { statusName: updateStatus } : {}),
  };
  return [create, update];
}

async function setup() {
  const [role] = await db.insert(rolesTable).values({
    nameJson: { en: runId },
    permissionsJson: {
      superAdmin: true,
      admin: {
        pages: false,
        entities: false,
        roles: false,
        users: false,
        translations: false,
        events: false,
        modules: false,
        googleDrive: false,
        settings: false,
        automations: false,
        customFilters: false,
        columnGroups: false,
        dataImport: true,
        inboundIntegrations: false,
      },
      pageIds: [],
      records: {},
    },
  }).returning({ id: rolesTable.id });
  ids.role = role!.id;

  const insertedUsers = await db.insert(usersTable).values([
    {
      email: `${runId}-blocked@example.invalid`,
      passwordHash: null,
      firstName: "Blocked",
      lastName: runId,
      roleId: ids.role,
    },
    {
      email: `${runId}-allowed@example.invalid`,
      passwordHash: null,
      firstName: "Allowed",
      lastName: runId,
      roleId: ids.role,
    },
  ]).returning({ id: usersTable.id });
  ids.blockedUser = insertedUsers[0]!.id;
  ids.allowedUser = insertedUsers[1]!.id;

  const [entity] = await db.insert(entitiesTable).values({
    entityKey: runId,
    nameJson: { en: runId },
  }).returning({ id: entitiesTable.id });
  ids.entity = entity!.id;

  await db.insert(entityFieldsTable).values([
    {
      entityId: ids.entity,
      fieldKey: "external_key",
      nameJson: { en: "External key" },
      fieldType: "text",
      isKey: true,
      isRequired: true,
    },
    {
      entityId: ids.entity,
      fieldKey: "name",
      nameJson: { en: "Name" },
      fieldType: "text",
    },
  ]);

  const statuses = await db.insert(entityStatusesTable).values([
    {
      entityId: ids.entity,
      statusKey: "default",
      nameJson: { en: "Default" },
      isDefault: true,
      sortOrder: 0,
    },
    {
      entityId: ids.entity,
      statusKey: "explicit",
      nameJson: { en: "Explicit" },
      sortOrder: 1,
    },
  ]).returning({ id: entityStatusesTable.id, statusKey: entityStatusesTable.statusKey });
  ids.defaultStatus = statuses.find((status) => status.statusKey === "default")!.id;
  ids.explicitStatus = statuses.find((status) => status.statusKey === "explicit")!.id;

  const [existing] = await db.insert(entityRecordsTable).values({
    entityId: ids.entity,
    valuesJson: { external_key: `${runId}:existing`, name: "Before import" },
    statusId: ids.defaultStatus,
  }).returning({ id: entityRecordsTable.id });
  ids.existingRecord = existing!.id;
}

async function cleanup() {
  if (ids.entity) {
    await db.delete(systemEventsTable).where(eq(systemEventsTable.entityId, ids.entity));
    await db.delete(entitiesTable).where(eq(entitiesTable.id, ids.entity));
  }
  const userIds = [ids.blockedUser, ids.allowedUser].filter((id): id is number => id != null);
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (ids.role) await db.delete(rolesTable).where(eq(rolesTable.id, ids.role));
}

after(async () => {
  await cleanup();
  await pool.end();
});

test("import routes enforce manual status permissions for create and update rows", async (t) => {
  await setup();

  for (const endpoint of ["preview", "commit"] as const) {
    await t.test(`${endpoint}: disabled_all rejects explicit status even for superAdmin`, async () => {
      await setPolicy("disabled_all");
      await resetExistingRecord();
      const result = await postImport(
        endpoint,
        ids.blockedUser!,
        rows(`${endpoint}:disabled-all`, "explicit", "explicit"),
      );
      assert.equal(result.ok, false);
      assert.equal(result.files[0]!.errors, 2);
      assert.deepEqual(
        result.files[0]!.rows.map((row) => [row.status, row.message]),
        [
          ["error", "Manual status editing is disabled for this user"],
          ["error", "Manual status editing is disabled for this user"],
        ],
      );
    });

    await t.test(`${endpoint}: disabled_users rejects selected users`, async () => {
      await setPolicy("disabled_users", [ids.blockedUser!]);
      await resetExistingRecord();
      const result = await postImport(
        endpoint,
        ids.blockedUser!,
        rows(`${endpoint}:blocked`, "explicit", "explicit"),
      );
      assert.equal(result.ok, false);
      assert.equal(result.files[0]!.errors, 2);
      assert.ok(result.files[0]!.rows.every((row) => row.status === "error"));
    });

    await t.test(`${endpoint}: disabled_users allows unselected users`, async () => {
      await setPolicy("disabled_users", [ids.blockedUser!]);
      await resetExistingRecord();
      const result = await postImport(
        endpoint,
        ids.allowedUser!,
        rows(`${endpoint}:allowed`, "explicit", "explicit"),
      );
      assert.equal(result.ok, true);
      assert.equal(result.files[0]!.created, 1);
      assert.equal(result.files[0]!.updated, 1);
      assert.equal(result.files[0]!.errors, 0);
    });

    await t.test(`${endpoint}: blank and omitted statuses keep default behavior`, async () => {
      await setPolicy("disabled_all");
      await resetExistingRecord();
      const result = await postImport(
        endpoint,
        ids.blockedUser!,
        rows(`${endpoint}:default`, "", undefined),
      );
      assert.equal(result.ok, true);
      assert.equal(result.files[0]!.created, 1);
      assert.equal(result.files[0]!.updated, 1);
      assert.equal(result.files[0]!.errors, 0);

      if (endpoint === "commit") {
        const records = await db.select({
          valuesJson: entityRecordsTable.valuesJson,
          statusId: entityRecordsTable.statusId,
        }).from(entityRecordsTable).where(and(
          eq(entityRecordsTable.entityId, ids.entity!),
          inArray(entityRecordsTable.id, [
            ids.existingRecord!,
            ...(await db.select({ id: entityRecordsTable.id })
              .from(entityRecordsTable)
              .where(and(
                eq(entityRecordsTable.entityId, ids.entity!),
                eq(entityRecordsTable.valuesJson, {
                  external_key: `${runId}:${endpoint}:default`,
                  name: "Created by import",
                }),
              ))).map((record) => record.id),
          ]),
        ));
        assert.equal(records.length, 2);
        assert.ok(records.every((record) => record.statusId === ids.defaultStatus));
      }
    });
  }
});