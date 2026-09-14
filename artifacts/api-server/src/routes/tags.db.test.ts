import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  entitiesTable,
  rolesTable,
  statusTagsTable,
  tagsTable,
  usersTable,
  pool,
  type RolePermissions,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import tagsRouter from "./tags";
import statusesRouter from "./statuses";
import rolesRouter from "./roles";
import { expandStatusTagRestrictions, mergePermissions } from "../middlewares/permissions";
import { STATUS_TAG_REFERENCE_LOCK } from "../lib/status-tag-lock";

const runId = `status-tags-${randomUUID()}`;
const ids: { allowedRole?: number; deniedRole?: number; allowedUser?: number; deniedUser?: number; entity?: number; tags: number[] } = { tags: [] };
const raceRoleIds: number[] = [];
type PoolClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  release(): void;
};

const app = express();
app.use(express.json());
app.use("/api", tagsRouter);
app.use("/api", statusesRouter);
app.use("/api", rolesRouter);
let server: ReturnType<typeof app.listen> | undefined;

function permissions(tags: boolean, entities = false, roles = false): RolePermissions {
  return {
    superAdmin: false,
    admin: {
      pages: false, entities, roles, users: false, translations: false,
      events: false, modules: false, automations: false, customFilters: false,
      columnGroups: false, googleDrive: false, settings: false, dataImport: false,
      inboundIntegrations: false, documentGeneration: false, tags,
    },
    pageIds: [],
    records: {},
  };
}

async function request(path: string, options: { allowed?: boolean; method?: string; body?: unknown } = {}) {
  assert.ok(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return fetch(`http://127.0.0.1:${address.port}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${signToken({
        userId: options.allowed === false ? ids.deniedUser! : ids.allowedUser!,
        roleId: options.allowed === false ? ids.deniedRole! : ids.allowedRole!,
      })}`,
      "content-type": "application/json",
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (ids.entity) await db.delete(entitiesTable).where(eq(entitiesTable.id, ids.entity));
  if (ids.tags.length) await db.delete(tagsTable).where(inArray(tagsTable.id, ids.tags));
  if (raceRoleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, raceRoleIds));
  const userIds = [ids.allowedUser, ids.deniedUser].filter((id): id is number => id != null);
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  const roleIds = [ids.allowedRole, ids.deniedRole].filter((id): id is number => id != null);
  if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));
  await pool.end();
});

test("global status tags enforce CRUD, assignment, safe deletion and admin capability", async (t) => {
  const roles = await db.insert(rolesTable).values([
    { nameJson: { en: `${runId} allowed` }, permissionsJson: permissions(true, true, true) },
    { nameJson: { en: `${runId} denied` }, permissionsJson: permissions(false, true) },
  ]).returning({ id: rolesTable.id });
  ids.allowedRole = roles[0]!.id;
  ids.deniedRole = roles[1]!.id;
  const users = await db.insert(usersTable).values([
    { email: `${runId}-allowed@example.invalid`, firstName: "Allowed", lastName: runId, passwordHash: null, roleId: ids.allowedRole },
    { email: `${runId}-denied@example.invalid`, firstName: "Denied", lastName: runId, passwordHash: null, roleId: ids.deniedRole },
  ]).returning({ id: usersTable.id });
  ids.allowedUser = users[0]!.id;
  ids.deniedUser = users[1]!.id;
  const [entity] = await db.insert(entitiesTable).values({ entityKey: `${runId}_entity`, nameJson: { en: "Tagged" } }).returning();
  ids.entity = entity.id;
  server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  await t.test("requires tags admin cap and rejects duplicate reorder ids", async () => {
    const denied = await request("/tags", { allowed: false, method: "POST", body: { nameJson: { en: "Denied" } } });
    assert.equal(denied.status, 403);
    const create = await request("/tags", { method: "POST", body: { nameJson: { en: "Urgent" }, color: "#dc2626", sortOrder: 2 } });
    assert.equal(create.status, 201);
    const tag = await create.json() as { id: number; applicableTo: string[] };
    ids.tags.push(tag.id);
    assert.deepEqual(tag.applicableTo, ["statuses"]);
    const rename = await request(`/tags/${tag.id}`, { method: "PUT", body: { nameJson: { en: "Renamed" }, sortOrder: 1 } });
    assert.equal(rename.status, 200);
    assert.deepEqual((await rename.json() as { nameJson: unknown }).nameJson, { en: "Renamed" });
    const withRoleReference = {
      ...permissions(true, true),
      records: { [String(ids.entity)]: { view: true, create: false, update: false, delete: false, hiddenStatusTagIds: [tag.id] } },
    };
    await db.update(rolesTable).set({ permissionsJson: withRoleReference }).where(eq(rolesTable.id, ids.allowedRole!));
    assert.equal((await request(`/tags/${tag.id}`, { method: "DELETE" })).status, 409);
    await db.update(rolesTable).set({ permissionsJson: permissions(true, true) }).where(eq(rolesTable.id, ids.allowedRole!));
    const duplicate = await request("/tags/reorder", { method: "POST", body: { items: [{ id: tag.id, sortOrder: 1 }, { id: tag.id, sortOrder: 2 }] } });
    assert.equal(duplicate.status, 400);
  });

  await t.test("status assignment round-trips and blocks deletion until unassigned", async () => {
    const tagId = ids.tags[0]!;
    const second = await request("/tags", { method: "POST", body: { nameJson: { en: "Also urgent" } } });
    assert.equal(second.status, 201);
    const secondTagId = (await second.json() as { id: number }).id;
    ids.tags.push(secondTagId);
    const createStatus = await request(`/entities/${ids.entity}/statuses`, {
      method: "POST",
      body: { statusKey: "tagged", nameJson: { en: "Tagged" }, tagIds: [tagId, tagId, secondTagId] },
    });
    assert.equal(createStatus.status, 201);
    const status = await createStatus.json() as { id: number; tagIds: number[] };
    assert.deepEqual(status.tagIds, [tagId, secondTagId]);
    const list = await request(`/entities/${ids.entity}/statuses`);
    assert.deepEqual((await list.json() as Array<{ tagIds: number[] }>)[0]!.tagIds, [tagId, secondTagId]);
    const entityKey = String(ids.entity);
    const base = { view: true, create: false, update: false, delete: false };
    const [firstExpanded, secondExpanded] = await Promise.all([
      expandStatusTagRestrictions({ ...permissions(false), records: { [entityKey]: { ...base, hiddenRowStatusTagIds: [tagId] } } }),
      expandStatusTagRestrictions({ ...permissions(false), records: { [entityKey]: { ...base, hiddenRowStatusTagIds: [secondTagId] } } }),
    ]);
    // Different tag ids overlap this status. Expanding each role before the
    // normal intersection preserves the hard row boundary; intersecting tag ids
    // first would incorrectly produce an empty restriction.
    assert.deepEqual(
      mergePermissions([firstExpanded, secondExpanded]).records[entityKey]!.hiddenRowStatusIds,
      [status.id],
    );
    assert.equal((await request(`/tags/${tagId}`, { method: "DELETE" })).status, 409);
    assert.equal((await request(`/statuses/${status.id}`, { method: "PUT", body: { tagIds: [] } })).status, 200);
    assert.equal((await db.select().from(statusTagsTable).where(eq(statusTagsTable.tagId, tagId))).length, 0);
    assert.equal((await request(`/tags/${tagId}`, { method: "DELETE" })).status, 200);
    ids.tags.splice(ids.tags.indexOf(tagId), 1);
    assert.equal((await request(`/tags/${secondTagId}`, { method: "DELETE" })).status, 200);
    ids.tags.splice(ids.tags.indexOf(secondTagId), 1);
  });

  await t.test("serializes deletion and role tag references in either ordering", async () => {
    const createRaceTag = async (label: string): Promise<number> => {
      const [tag] = await db.insert(tagsTable).values({ nameJson: { en: `${runId} ${label}` } }).returning({ id: tagsTable.id });
      ids.tags.push(tag.id);
      return tag.id;
    };
    const referenceJson = (tagId: number) => ({
      records: {
        [String(ids.entity)]: {
          view: true, create: false, update: false, delete: false, hiddenStatusTagIds: [tagId],
        },
      },
    });
    const waitForAdvisoryWaiter = async (client: PoolClient) => {
      const deadline = Date.now() + 5_000;
      for (;;) {
        const { rows } = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND granted = false",
        );
        if (Number(rows[0]?.count ?? 0) >= 1) return;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for concurrent tag reference operation");
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    };
    const writeRoleReference = async (client: PoolClient, tagId: number) => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [STATUS_TAG_REFERENCE_LOCK]);
        const { rowCount } = await client.query("SELECT 1 FROM tags WHERE id = $1", [tagId]);
        if (rowCount === 0) {
          await client.query("COMMIT");
          return false;
        }
        const inserted = await client.query<{ id: number }>(
          "INSERT INTO roles (name_json, permissions_json) VALUES ($1::jsonb, $2::jsonb) RETURNING id",
          [JSON.stringify({ en: `${runId} race reference` }), JSON.stringify(referenceJson(tagId))],
        );
        raceRoleIds.push(inserted.rows[0]!.id);
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    };
    const deleteIfUnreferenced = async (client: PoolClient, tagId: number) => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [STATUS_TAG_REFERENCE_LOCK]);
        const reference = await client.query(
          "SELECT 1 FROM roles WHERE permissions_json @> $1::jsonb LIMIT 1",
          [JSON.stringify(referenceJson(tagId))],
        );
        if (reference.rowCount !== 0) {
          await client.query("COMMIT");
          return false;
        }
        const deleted = await client.query("DELETE FROM tags WHERE id = $1", [tagId]);
        await client.query("COMMIT");
        return deleted.rowCount === 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    };

    // Delete wins: the reference writer validates only after deletion and refuses
    // to persist a dangling tag id.
    const deleteFirstTagId = await createRaceTag("delete first");
    const deleteFirstHolder = await pool.connect() as unknown as PoolClient;
    const writerClient = await pool.connect() as unknown as PoolClient;
    let writing: Promise<boolean> | undefined;
    try {
      await deleteFirstHolder.query("BEGIN");
      await deleteFirstHolder.query("SELECT pg_advisory_xact_lock($1)", [STATUS_TAG_REFERENCE_LOCK]);
      writing = writeRoleReference(writerClient, deleteFirstTagId);
      await waitForAdvisoryWaiter(deleteFirstHolder);
      await deleteFirstHolder.query("DELETE FROM tags WHERE id = $1", [deleteFirstTagId]);
      await deleteFirstHolder.query("COMMIT");
      assert.equal(await writing, false);
    } finally {
      await deleteFirstHolder.query("ROLLBACK").catch(() => undefined);
      if (writing) await writing.catch(() => undefined);
      writerClient.release();
      deleteFirstHolder.release();
    }

    // Reference wins: deletion observes the committed reference after it gets
    // the lock, so it leaves the tag intact instead of orphaning the role JSON.
    const referenceFirstTagId = await createRaceTag("reference first");
    const referenceFirstHolder = await pool.connect() as unknown as PoolClient;
    const deletingClient = await pool.connect() as unknown as PoolClient;
    let deleting: Promise<boolean> | undefined;
    try {
      await referenceFirstHolder.query("BEGIN");
      await referenceFirstHolder.query("SELECT pg_advisory_xact_lock($1)", [STATUS_TAG_REFERENCE_LOCK]);
      deleting = deleteIfUnreferenced(deletingClient, referenceFirstTagId);
      await waitForAdvisoryWaiter(referenceFirstHolder);
      const inserted = await referenceFirstHolder.query<{ id: number }>(
        "INSERT INTO roles (name_json, permissions_json) VALUES ($1::jsonb, $2::jsonb) RETURNING id",
        [JSON.stringify({ en: `${runId} race winner` }), JSON.stringify(referenceJson(referenceFirstTagId))],
      );
      raceRoleIds.push(inserted.rows[0]!.id);
      await referenceFirstHolder.query("COMMIT");
      assert.equal(await deleting, false);
    } finally {
      await referenceFirstHolder.query("ROLLBACK").catch(() => undefined);
      if (deleting) await deleting.catch(() => undefined);
      deletingClient.release();
      referenceFirstHolder.release();
    }
    await db.delete(rolesTable).where(sql`permissions_json @> ${JSON.stringify(referenceJson(referenceFirstTagId))}::jsonb`);
    raceRoleIds.length = 0;
    await db.delete(tagsTable).where(eq(tagsTable.id, referenceFirstTagId));
    for (const tagId of [deleteFirstTagId, referenceFirstTagId]) {
      const index = ids.tags.indexOf(tagId);
      if (index >= 0) ids.tags.splice(index, 1);
    }
  });
});