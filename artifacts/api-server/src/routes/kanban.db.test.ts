import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable,
  entityStatusesTable, pagesTable, pageFieldsTable, rolesTable, usersTable,
  auditLogTable, systemEventsTable, mirrorPermKey,
  type RolePermissions,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import recordsRouter from "./records";
import statusesRouter from "./statuses";
import viewsRouter from "./views";

after(() => pool.end());

test("Kanban configuration and status soft hiding preserve all hard boundaries", {
  skip: process.env.RUN_KANBAN_DB_TESTS !== "1",
}, async (t) => {
  // Require an independently supplied development fingerprint before fixture writes.
  const endpoint = new URL(process.env.DATABASE_URL!);
  assert.equal(endpoint.hostname, "helium");
  assert.equal(endpoint.pathname, "/heliumdb");
  const identity = await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`);
  assert.equal(identity.rows[0].database, "heliumdb");
  assert.ok(process.env.KANBAN_DEV_FINGERPRINT);
  assert.equal(identity.rows[0].fingerprint, process.env.KANBAN_DEV_FINGERPRINT);

  const key = `kanban_${randomUUID().replaceAll("-", "")}`;
  let entityId: number | undefined;
  let pageId: number | undefined;
  let roleId: number | undefined;
  const userIds: number[] = [];
  const app = express();
  app.use(express.json());
  app.use("/api", statusesRouter, viewsRouter, recordsRouter);
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    const [entity] = await db.insert(entitiesTable).values({ entityKey: key, nameJson: { en: key } }).returning();
    entityId = entity.id;
    const [role] = await db.insert(rolesTable).values({ nameJson: { en: key } }).returning();
    roleId = role.id;
    const users = await db.insert(usersTable).values([
      { email: `${key}@example.invalid`, firstName: key, lastName: "Viewer", roleId, passwordHash: null },
      { email: `${key}_other@example.invalid`, firstName: key, lastName: "Other", roleId, passwordHash: null },
    ]).returning();
    userIds.push(...users.map((u) => u.id));
    await db.insert(entityFieldsTable).values([
      { entityId, fieldKey: "title", nameJson: { en: "Title" }, fieldType: "text" },
      { entityId, fieldKey: "owner", nameJson: { en: "Owner" }, fieldType: "user" },
      { entityId, fieldKey: "bucket", nameJson: { en: "Bucket" }, fieldType: "text" },
      { entityId, fieldKey: "secret", nameJson: { en: "Secret" }, fieldType: "text", permissionsJson: { [String(roleId)]: "hidden" } },
    ]);
    const [page] = await db.insert(pagesTable).values({ nameJson: { en: key }, mirrorEntityId: entityId }).returning();
    pageId = page.id;
    await db.insert(pageFieldsTable).values({ pageId, fieldKey: "local", fieldType: "text", nameJson: { en: "Local" } });
    const statuses = await db.insert(entityStatusesTable).values([
      { entityId, statusKey: "visible", nameJson: { en: "Visible" } },
      { entityId, statusKey: "soft_hidden", nameJson: { en: "Soft" }, hideByDefault: true },
      { entityId, statusKey: "hard_hidden", nameJson: { en: "Hard" }, hideByDefault: true },
    ]).returning();
    const permissions: RolePermissions = {
      superAdmin: false,
      admin: { entities: true, pages: false, roles: false, users: false, translations: false,
        events: false, modules: false, automations: false, customFilters: false,
        columnGroups: false, googleDrive: false, settings: false, dataImport: false,
        inboundIntegrations: false, documentGeneration: false, tags: false },
      pageIds: [pageId],
      records: { [String(entityId)]: { view: true, create: true, update: true, delete: true,
        scope: "own", scopeFieldKeys: ["owner"], hiddenRowStatusIds: [statuses[2].id] } },
    };
    await db.update(rolesTable).set({ permissionsJson: permissions }).where(eq(rolesTable.id, roleId));
    const rows = await db.insert(entityRecordsTable).values([
      { entityId, statusId: statuses[0].id, valuesJson: { title: "Visible", owner: users[0].id, bucket: "keep", secret: "private" } },
      { entityId, statusId: statuses[1].id, valuesJson: { title: "Soft", owner: users[0].id, bucket: "keep" } },
      { entityId, statusId: statuses[2].id, valuesJson: { title: "Hard", owner: users[0].id, bucket: "keep" } },
      { entityId, statusId: null, valuesJson: { title: "Null", owner: users[0].id, bucket: "keep" } },
      { entityId, statusId: statuses[1].id, valuesJson: { title: "Other", owner: users[1].id, bucket: "keep" } },
      { entityId, statusId: statuses[1].id, valuesJson: { title: "Filtered", owner: users[0].id, bucket: "drop" } },
      { entityId, statusId: statuses[1].id, archivedAt: new Date(), valuesJson: { title: "Archived", owner: users[0].id, bucket: "keep" } },
    ]).returning();
    server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const request = async <T = Record<string, any>>(path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method,
        headers: { authorization: `Bearer ${signToken({ userId: users[0].id, roleId: role.id })}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json() as T;
      return { status: response.status, body: result };
    };
    const query = async (body: unknown) => {
      const result = await request(`/entities/${entityId}/records/query`, "POST", body);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body as { data: Array<{ id: number; valuesJson: Record<string, unknown> }>; total: number };
    };
    const ids = (result: Awaited<ReturnType<typeof query>>) => result.data.map((r) => r.id).sort((a, b) => a - b);
    const sorted = (...indexes: number[]) => indexes.map((i) => rows[i].id).sort((a, b) => a - b);
    const kanban = { titleField: "title", fields: ["owner", "__status__"], showLabels: true, hideEmptyFields: true };
    let viewId = 0;

    await t.test("create/update/list status preference defaults and false round-trip", async () => {
      const created = await request(`/entities/${entityId}/statuses`, "POST", { statusKey: "new", nameJson: { en: "New" } });
      assert.equal(created.status, 201);
      assert.equal(created.body.hideByDefault, false);
      const hidden = await request(`/statuses/${created.body.id}`, "PUT", { hideByDefault: true });
      assert.equal(hidden.status, 200);
      assert.equal(hidden.body.hideByDefault, true);
      const renamed = await request(`/statuses/${created.body.id}`, "PUT", { nameJson: { en: "Renamed" } });
      assert.equal(renamed.body.hideByDefault, true);
      const shown = await request(`/statuses/${created.body.id}`, "PUT", { hideByDefault: false });
      assert.equal(shown.body.hideByDefault, false);
      const list = await request<Array<{ id: number; hideByDefault: boolean }>>(`/entities/${entityId}/statuses`);
      assert.equal(list.body.find((s) => s.id === created.body.id)!.hideByDefault, false);
    });
    await t.test("validated Kanban config persists in named views and targeted page fields", async () => {
      const created = await request(`/entities/${entityId}/views`, "POST", {
        viewKey: "kanban", nameJson: { en: "Kanban" }, configJson: { viewType: "kanban", kanban,
          filters: [{ field: "bucket", operator: "eq", value: "keep" }] },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      viewId = created.body.id;
      assert.deepEqual(created.body.configJson.kanban, kanban);
      const read = await request(`/views/${viewId}`);
      assert.equal(read.body.configJson.viewType, "kanban");
      assert.deepEqual(read.body.configJson.kanban, kanban);
      const changed = { ...kanban, titleField: null, fields: ["title"], showLabels: false };
      const updated = await request(`/views/${viewId}`, "PUT", {
        configJson: { ...read.body.configJson, kanban: changed },
      });
      assert.equal(updated.status, 200);
      assert.deepEqual((await request(`/views/${viewId}`)).body.configJson.kanban, changed);
      for (const invalid of [
        { viewType: "kanban" },
        { viewType: "kanban", kanban: { ...kanban, fields: ["missing"] } },
        { viewType: "kanban", kanban: { ...kanban, fields: ["title", "title"] } },
        { viewType: "kanban", kanban: { ...kanban, titleField: "page:local" } },
        { viewType: "kanban", kanban: { ...kanban, showLabels: "yes" } },
      ]) {
        assert.equal((await request(`/entities/${entityId}/views`, "POST", { viewKey: "invalid", nameJson: {}, configJson: invalid })).status, 400);
      }
      const mirror = await request(`/entities/${entityId}/views`, "POST", {
        viewKey: "mirror", nameJson: {}, targetPageId: pageId,
        configJson: { viewType: "kanban", kanban: { ...kanban, titleField: "page:local", fields: ["title", "page:local"] } },
      });
      assert.equal(mirror.status, 201, JSON.stringify(mirror.body));
      assert.equal((await request(`/views/${mirror.body.id}`)).body.configJson.kanban.titleField, "page:local");
      // Moving a page-field Kanban to main scope must revalidate the stored config.
      assert.equal((await request(`/views/${mirror.body.id}`, "PUT", { targetPageId: null })).status, 400);
    });
    await t.test("override only removes soft hiding; never widens own rows, hard view, role status or fields", async () => {
      const ordinary = await query({ viewId });
      assert.deepEqual(ids(ordinary), sorted(0, 3));
      assert.equal(ordinary.total, 2);
      assert.ok(!("secret" in ordinary.data.find((r) => r.id === rows[0].id)!.valuesJson));
      const override = await query({ viewId, showHiddenStatuses: true, filterConjunction: "or",
        filters: [{ field: "bucket", operator: "eq", value: "drop" }, { field: "bucket", operator: "eq", value: "keep" }] });
      assert.deepEqual(ids(override), sorted(0, 1, 3));
      assert.equal(override.total, 3);
      assert.deepEqual(ids(await query({ viewId, showHiddenStatuses: true, statusIds: [statuses[2].id] })), []);
      assert.deepEqual(ids(await query({ viewId, showHiddenStatuses: true, excludeStatusIds: [statuses[1].id] })), sorted(0, 3));
    });
    await t.test("null lane is an AND restriction, and archive remains independent", async () => {
      assert.deepEqual(ids(await query({ viewId, statusIsNull: true })), sorted(3));
      assert.deepEqual(ids(await query({ viewId, statusIsNull: true, statusIds: [statuses[0].id], showHiddenStatuses: true })), []);
      assert.deepEqual(ids(await query({ viewId, archived: "archived" })), []);
      assert.deepEqual(ids(await query({ viewId, archived: "archived", showHiddenStatuses: true })), sorted(6));
      assert.deepEqual(ids(await query({ viewId, archived: "all", showHiddenStatuses: true })), sorted(0, 1, 3, 6));
    });
    await t.test("mirror archive/unarchive honors override, own rows, hidden statuses and version checks", async () => {
      const entityPermission = permissions.records[String(entityId)]!;
      const mirrorPermission = { ...entityPermission, update: true, scope: "own" as const, scopeFieldKeys: ["owner"] };
      const mirrorPermissions: RolePermissions = {
        ...permissions,
        records: {
          [String(entityId)]: { ...entityPermission, update: false },
          [mirrorPermKey(pageId!)]: mirrorPermission,
        },
      };
      await db.update(rolesTable).set({ permissionsJson: mirrorPermissions }).where(eq(rolesTable.id, role.id));
      const archivePath = `/records/${rows[0].id}/archive`;
      const unarchivePath = `/records/${rows[0].id}/unarchive`;
      assert.equal((await request(archivePath, "POST", { expectedVersion: rows[0].version })).status, 403);
      // A foreign/nonexistent or unauthorized page cannot lend its override.
      assert.equal((await request(archivePath, "POST", { pageId: pageId! + 1000000 })).status, 403);
      await db.update(rolesTable).set({ permissionsJson: { ...mirrorPermissions, pageIds: [] } }).where(eq(rolesTable.id, role.id));
      assert.equal((await request(archivePath, "POST", { pageId })).status, 403);
      await db.update(rolesTable).set({ permissionsJson: mirrorPermissions }).where(eq(rolesTable.id, role.id));
      assert.equal((await request(`/records/${rows[4].id}/archive`, "POST", { pageId })).status, 404);
      assert.equal((await request(`/records/${rows[2].id}/archive`, "POST", { pageId })).status, 404);
      const archived = await request(archivePath, "POST", { pageId, expectedVersion: rows[0].version });
      assert.equal(archived.status, 200, JSON.stringify(archived.body));
      assert.ok(archived.body.archivedAt);
      assert.ok(!("secret" in archived.body.valuesJson));
      assert.ok(archived.body.version > rows[0].version);
      const stale = await request(unarchivePath, "POST", { pageId, expectedVersion: rows[0].version });
      assert.equal(stale.status, 409);
      const unarchived = await request(unarchivePath, "POST", { pageId, expectedVersion: archived.body.version });
      assert.equal(unarchived.status, 200, JSON.stringify(unarchived.body));
      assert.equal(unarchived.body.archivedAt, null);
      assert.ok(!("secret" in unarchived.body.valuesJson));
      assert.ok(unarchived.body.version > archived.body.version);
      const [stored] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, rows[0].id));
      assert.equal(stored.archiveExempt, true);

      // A narrower mirror override must replace broader entity update/scope.
      const deniedMirror = { ...permissions, records: {
        [String(entityId)]: { ...entityPermission, scope: "all" as const },
        [mirrorPermKey(pageId!)]: { ...mirrorPermission, update: false },
      } };
      await db.update(rolesTable).set({ permissionsJson: deniedMirror }).where(eq(rolesTable.id, role.id));
      assert.equal((await request(archivePath, "POST", { pageId })).status, 403);
      assert.equal((await request(unarchivePath, "POST", { pageId })).status, 403);
      deniedMirror.records[mirrorPermKey(pageId!)] = { ...mirrorPermission, scopeFieldKeys: [] };
      await db.update(rolesTable).set({ permissionsJson: deniedMirror }).where(eq(rolesTable.id, role.id));
      assert.equal((await request(archivePath, "POST", { pageId })).status, 404);
      await db.update(rolesTable).set({ permissionsJson: permissions }).where(eq(rolesTable.id, role.id));
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (pageId != null) await db.delete(pagesTable).where(eq(pagesTable.id, pageId));
    if (entityId != null) {
      await db.delete(auditLogTable).where(eq(auditLogTable.entityId, entityId));
      await db.delete(systemEventsTable).where(eq(systemEventsTable.entityId, entityId));
      await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    if (roleId != null) await db.delete(rolesTable).where(eq(rolesTable.id, roleId));
  }
});