import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool, rolesTable, usersTable, pagesTable, entitiesTable, customFiltersTable, NO_ACCESS_PERMS, type RolePermissions } from "@workspace/db";
import router from "../routes/custom-filters";
import { signToken } from "./jwt";

test("mirror filter discovery is quiet for own-scope viewers without granting entity access", async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  const schema = `page_filters_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    for (const { tablename } of (await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const own = { view: true, create: false, update: false, delete: false, scope: "own" as const, scopeFieldKeys: ["owner"] };
    const roles: RolePermissions[] = [
      { ...NO_ACCESS_PERMS, pageIds: [1], records: { "mirror:1": own } },
      { ...NO_ACCESS_PERMS, pageIds: [1], records: { "1": own } },
      { ...NO_ACCESS_PERMS, records: { "1": own } },
      { ...NO_ACCESS_PERMS, pageIds: [1] },
      { ...NO_ACCESS_PERMS, superAdmin: true },
    ];
    for (let i = 0; i < roles.length; i++) {
      await db.insert(rolesTable).values({ id: i + 1, nameJson: {}, permissionsJson: roles[i] });
      await db.insert(usersTable).values({ id: i + 1, email: `user${i}@fixture.invalid`, firstName: "Fixture", lastName: "", roleId: i + 1 });
    }
    await db.insert(entitiesTable).values({ id: 1, entityKey: "fixture", nameJson: {} });
    await db.insert(pagesTable).values([{ id: 1, mirrorEntityId: 1, nameJson: {} }, { id: 2, mirrorEntityId: 1, nameJson: {} }]);
    await db.insert(customFiltersTable).values({ id: 1, entityId: 1, nameJson: { ru: "Private filter" } });
    const app = express(); app.use(express.json(), router);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const get = (path: string, userId?: number) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: userId ? { authorization: `Bearer ${signToken({ userId, roleId: userId })}` } : {},
    });
    const mirrorOnly = await get("/pages/1/custom-filters", 1);
    assert.equal(mirrorOnly.status, 200);
    assert.deepEqual(await mirrorOnly.json(), []);
    assert.equal((await get("/entities/1/custom-filters", 1)).status, 403, "Direct entity probe still denied");
    assert.equal((await get("/pages/2/custom-filters", 1)).status, 403, "Other page still denied");
    assert.equal((await get("/pages/1/custom-filters", 3)).status, 403, "Entity permission does not grant page membership");
    assert.equal((await get("/pages/1/custom-filters", 4)).status, 403, "Page membership alone is insufficient");
    assert.equal((await get("/pages/1/custom-filters")).status, 401);
    assert.equal((await get("/pages/999/custom-filters", 1)).status, 404);
    assert.equal((await get("/pages/not-a-number/custom-filters", 1)).status, 400);
    for (const id of [2, 5]) {
      const res = await get("/pages/1/custom-filters", id);
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json() as { id: number }[]).map(r => r.id), [1]);
    }
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release(); await pool.end();
  }
});
