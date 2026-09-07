import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  automationFoldersTable,
  db,
  entitiesTable,
  entityAutomationsTable,
  pool,
  rolesTable,
  usersTable,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import automationsRouter from "./automations";

const runId = `automation-folders-${randomUUID()}`;
const ids: {
  allowedRole?: number;
  deniedRole?: number;
  allowedUser?: number;
  deniedUser?: number;
  entityA?: number;
  entityB?: number;
} = {};

const app = express();
app.use(express.json());
app.use("/api", automationsRouter);

let server: ReturnType<typeof app.listen> | undefined;

async function request(
  path: string,
  options: { userId?: number; roleId?: number; method?: string; body?: unknown } = {},
) {
  assert.ok(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return fetch(`http://127.0.0.1:${address.port}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${signToken({
        userId: options.userId ?? ids.allowedUser!,
        roleId: options.roleId ?? ids.allowedRole!,
      })}`,
      "content-type": "application/json",
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function cleanup() {
  const entityIds = [ids.entityA, ids.entityB].filter((id): id is number => id != null);
  if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
  const userIds = [ids.allowedUser, ids.deniedUser].filter((id): id is number => id != null);
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  const roleIds = [ids.allowedRole, ids.deniedRole].filter((id): id is number => id != null);
  if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));
}

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => error ? reject(error) : resolve()));
  }
  await cleanup();
  await pool.end();
});

test("automation folders API and database contract", async (t) => {
  const permissions = (automations: boolean) => ({
    superAdmin: false,
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
      automations,
      customFilters: false,
      columnGroups: false,
      dataImport: false,
      inboundIntegrations: false,
      documentGeneration: false,
    },
    pageIds: [],
    records: {},
  });
  const roles = await db.insert(rolesTable).values([
    { nameJson: { en: `${runId}-allowed` }, permissionsJson: permissions(true) },
    { nameJson: { en: `${runId}-denied` }, permissionsJson: permissions(false) },
  ]).returning({ id: rolesTable.id });
  ids.allowedRole = roles[0]!.id;
  ids.deniedRole = roles[1]!.id;

  const users = await db.insert(usersTable).values([
    {
      email: `${runId}-allowed@example.invalid`,
      firstName: "Allowed",
      lastName: runId,
      passwordHash: null,
      roleId: ids.allowedRole,
    },
    {
      email: `${runId}-denied@example.invalid`,
      firstName: "Denied",
      lastName: runId,
      passwordHash: null,
      roleId: ids.deniedRole,
    },
  ]).returning({ id: usersTable.id });
  ids.allowedUser = users[0]!.id;
  ids.deniedUser = users[1]!.id;

  const entities = await db.insert(entitiesTable).values([
    { entityKey: `${runId}-a`, nameJson: { en: "A" } },
    { entityKey: `${runId}-b`, nameJson: { en: "B" } },
  ]).returning({ id: entitiesTable.id });
  ids.entityA = entities[0]!.id;
  ids.entityB = entities[1]!.id;

  server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  await t.test("denies users without the automations admin capability", async () => {
    const response = await request(`/entities/${ids.entityA}/automation-folders`, {
      userId: ids.deniedUser,
      roleId: ids.deniedRole,
    });
    assert.equal(response.status, 403);
  });

  let folderA1 = 0;
  let folderA2 = 0;
  let folderB = 0;
  await t.test("supports CRUD and entity-isolated lists", async () => {
    const create = async (entityId: number, name: string, sortOrder: number) => {
      const response = await request(`/entities/${entityId}/automation-folders`, {
        method: "POST",
        body: { nameJson: { en: name, he: `he-${name}` }, sortOrder },
      });
      assert.equal(response.status, 201);
      return await response.json() as { id: number };
    };
    folderA1 = (await create(ids.entityA!, "A1", 20)).id;
    folderA2 = (await create(ids.entityA!, "A2", 10)).id;
    folderB = (await create(ids.entityB!, "B", 0)).id;

    const list = await request(`/entities/${ids.entityA}/automation-folders`);
    assert.equal(list.status, 200);
    const rows = await list.json() as Array<{ id: number }>;
    assert.deepEqual(rows.map((row) => row.id), [folderA2, folderA1]);
    assert.ok(!rows.some((row) => row.id === folderB));

    const update = await request(`/automation-folders/${folderA1}`, {
      method: "PUT",
      body: { nameJson: { ru: "Обновлено" } },
    });
    assert.equal(update.status, 200);
    assert.deepEqual((await update.json() as { nameJson: unknown }).nameJson, { ru: "Обновлено" });
  });

  await t.test("validates reorder duplicates and cross-entity folder ids", async () => {
    const duplicate = await request("/automation-folders/reorder", {
      method: "POST",
      body: { entityId: ids.entityA, items: [{ id: folderA1, sortOrder: 1 }, { id: folderA1, sortOrder: 2 }] },
    });
    assert.equal(duplicate.status, 400);

    const foreign = await request("/automation-folders/reorder", {
      method: "POST",
      body: { entityId: ids.entityA, items: [{ id: folderB, sortOrder: 1 }] },
    });
    assert.equal(foreign.status, 400);

    const valid = await request("/automation-folders/reorder", {
      method: "POST",
      body: { entityId: ids.entityA, items: [{ id: folderA1, sortOrder: 0 }, { id: folderA2, sortOrder: 1 }] },
    });
    assert.equal(valid.status, 200);
  });

  await t.test("validates assignment, allows null ungrouping, and preserves automation on folder delete", async () => {
    const crossEntity = await request(`/entities/${ids.entityA}/automations`, {
      method: "POST",
      body: { folderId: folderB, triggerJson: { type: "record_created" }, actionsJson: [] },
    });
    assert.equal(crossEntity.status, 400);

    const create = await request(`/entities/${ids.entityA}/automations`, {
      method: "POST",
      body: { folderId: folderA1, triggerJson: { type: "record_created" }, actionsJson: [] },
    });
    assert.equal(create.status, 201);
    const automation = await create.json() as { id: number; folderId: number | null };
    assert.equal(automation.folderId, folderA1);

    const ungroup = await request(`/automations/${automation.id}`, {
      method: "PUT",
      body: { folderId: null },
    });
    assert.equal(ungroup.status, 200);
    assert.equal((await ungroup.json() as { folderId: number | null }).folderId, null);

    await request(`/automations/${automation.id}`, { method: "PUT", body: { folderId: folderA1 } });
    const removeFolder = await request(`/automation-folders/${folderA1}`, { method: "DELETE" });
    assert.equal(removeFolder.status, 200);
    const [preserved] = await db
      .select({ folderId: entityAutomationsTable.folderId })
      .from(entityAutomationsTable)
      .where(eq(entityAutomationsTable.id, automation.id));
    assert.ok(preserved);
    assert.equal(preserved.folderId, null);
  });

  await t.test("entity deletion cascades its folders", async () => {
    await db.delete(entitiesTable).where(eq(entitiesTable.id, ids.entityB!));
    ids.entityB = undefined;
    const [folder] = await db
      .select({ id: automationFoldersTable.id })
      .from(automationFoldersTable)
      .where(eq(automationFoldersTable.id, folderB));
    assert.equal(folder, undefined);
  });
});