import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, pagesTable, usersTable, rolesTable } from "@workspace/db";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";

test("system pages reject destructive edits but retain menu customization", async ({ request }) => {
  const fingerprint = await db.execute(sql`SELECT md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) AS fingerprint FROM entities`);
  expect(process.env.CARD_E2E_DEV_FINGERPRINT).toMatch(/^[a-f0-9]{32}$/);
  expect(fingerprint.rows[0]?.fingerprint).toBe(process.env.CARD_E2E_DEV_FINGERPRINT);
  const [admin] = await db.select({ id: usersTable.id, roleId: usersTable.roleId }).from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
    .where(sql`${usersTable.isActive} = true AND ${rolesTable.permissionsJson}->>'superAdmin' = 'true'`).limit(1);
  const headers = { Authorization: `Bearer ${signToken({ userId: admin.id, roleId: admin.roleId })}` };
  const tag = randomUUID();
  const created = await request.post("/api/pages", { headers, data: { nameJson: { en: tag }, icon: "file", path: `/system-fixture-${tag}` } });
  expect(created.status()).toBe(201);
  const page = await created.json();
  try {
    await db.update(pagesTable).set({ isSystem: true }).where(eq(pagesTable.id, page.id));
    for (const data of [
      { isActive: false }, { path: "/other" }, { parentPageId: page.id },
      { isDashboard: true }, { isPivot: true }, { mirrorEntityId: 123 }, { pivotEntityId: 123 },
    ]) {
      expect((await request.put(`/api/pages/${page.id}`, { headers, data })).status()).toBe(403);
    }
    expect((await request.delete(`/api/pages/${page.id}`, { headers })).status()).toBe(403);
    const allowed = await request.put(`/api/pages/${page.id}`, { headers, data: {
      nameJson: { en: "Renamed system fixture" }, icon: "settings", sortOrder: 91, menuDefaultExpanded: false,
    } });
    expect(allowed.status()).toBe(200);
    expect(await allowed.json()).toMatchObject({ isSystem: true, isActive: true, path: page.path, menuDefaultExpanded: false });
    const spoof = await request.put(`/api/pages/${page.id}`, { headers, data: { isSystem: false, isActive: false } });
    expect(spoof.status()).toBe(403);
    expect((await request.post("/api/pages", { headers, data: { nameJson: { en: tag }, icon: "file", path: "/admin/forbidden" } })).status()).toBe(403);
    await db.update(pagesTable).set({ isSystem: false }).where(eq(pagesTable.id, page.id));
    expect((await request.put(`/api/pages/${page.id}`, { headers, data: { isActive: false } })).status()).toBe(200);
    expect((await request.delete(`/api/pages/${page.id}`, { headers })).status()).toBe(200);
  } finally {
    await db.delete(pagesTable).where(eq(pagesTable.id, page.id));
    await pool.end();
  }
});