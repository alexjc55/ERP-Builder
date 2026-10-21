import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool, rolesTable, usersTable, entitiesTable, entityFoldersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import router from "./entities";
import { signToken } from "../lib/jwt";

test("entity folders: permissions, validation, assignment, rename and safe deletion", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  const suffix = randomUUID().replaceAll("-", "");
  const roles = await db.insert(rolesTable).values([true, false].map(entities => ({
    nameJson: { en: suffix }, permissionsJson: { superAdmin: false, admin: { entities,
      pages: false, roles: false, users: false, translations: false, events: false, modules: false,
      googleDrive: false, settings: false, automations: false, customFilters: false, columnGroups: false,
      dataImport: false, inboundIntegrations: false, documentGeneration: false,
    }, records: {}, pageIds: [] },
  }))).returning();
  const users = await db.insert(usersTable).values(roles.map((r, i) => ({
    firstName: "Folder test", lastName: suffix, email: `folder-${suffix}-${i}@example.invalid`, roleId: r.id, passwordHash: null,
  }))).returning();
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  const addr = server.address(); assert.ok(addr && typeof addr !== "string");
  const call = (path: string, method = "GET", body?: unknown, user = 0) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method, headers: { "content-type": "application/json", authorization: `Bearer ${signToken({ userId: users[user].id, roleId: roles[user].id })}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let folderId = 0, entityId = 0;
  try {
    assert.equal((await call("/entity-folders", "GET", undefined, 1)).status, 403);
    assert.equal((await call("/entity-folders", "POST", { nameJson: { ru: "Недоступно" } }, 1)).status, 403);
    assert.equal((await call("/entity-folders", "POST", { nameJson: { ru: " " } })).status, 400);
    const created = await call("/entity-folders", "POST", { nameJson: { ru: "Тест", he: "בדיקה" } });
    assert.equal(created.status, 201); folderId = ((await created.json()) as { id: number }).id;
    assert.ok(((await (await call("/entity-folders")).json()) as { id: number }[]).some(f => f.id === folderId));
    const entity = await call("/entities", "POST", { entityKey: `folder_${suffix}`, nameJson: { ru: "Сущность" }, icon: "table", folderId });
    assert.equal(entity.status, 201); entityId = ((await entity.json()) as { id: number }).id;
    assert.equal((await call(`/entities/${entityId}`, "PUT", { folderId: 2147483647 })).status, 400);
    assert.equal((await call(`/entities/${entityId}`, "PUT", { folderId: null })).status, 200);
    assert.equal((await call(`/entities/${entityId}`, "PUT", { folderId })).status, 200);
    assert.equal((await call(`/entity-folders/${folderId}`, "PUT", { nameJson: { ru: "Переименовано" } })).status, 200);
    assert.equal((await call(`/entity-folders/${folderId}`, "DELETE", undefined, 1)).status, 403);
    assert.equal((await call(`/entity-folders/${folderId}`, "DELETE")).status, 204);
    const preserved = await (await call(`/entities/${entityId}`)).json() as { folderId: number | null; entityKey: string };
    assert.equal(preserved.folderId, null);
    assert.equal(preserved.entityKey, `folder_${suffix}`);
    assert.equal((await call(`/entity-folders/${folderId}`, "DELETE")).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (entityId) await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
    if (folderId) await db.delete(entityFoldersTable).where(eq(entityFoldersTable.id, folderId));
    await db.delete(usersTable).where(inArray(usersTable.id, users.map(u => u.id)));
    await db.delete(rolesTable).where(inArray(rolesTable.id, roles.map(r => r.id)));
    await pool.end();
  }
});
