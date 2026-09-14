import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, rolesTable, userRolesTable, usersTable, type RolePermissions } from "@workspace/db";
import { signToken } from "../lib/jwt";
import { requireAuth } from "./auth";
import { getPermissions, getUserRoleIds } from "./permissions";

const runId = `role-context-${randomUUID()}`;
const app = express();
let server: ReturnType<typeof app.listen> | undefined;
let userId: number | undefined;
let staleRoleId: number | undefined;
let currentRoleId: number | undefined;

function permissions(tags: boolean): RolePermissions {
  return {
    superAdmin: false,
    admin: {
      pages: false, entities: false, roles: false, users: false, translations: false,
      events: false, modules: false, automations: false, customFilters: false,
      columnGroups: false, googleDrive: false, settings: false, dataImport: false,
      inboundIntegrations: false, documentGeneration: false, tags,
    },
    pageIds: [],
    records: {},
  };
}

app.get("/permission-context", requireAuth, async (req, res) => {
  const [roleIds, permissionSet] = await Promise.all([getUserRoleIds(req), getPermissions(req)]);
  res.json({ roleIds, tags: permissionSet.admin.tags === true });
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (userId != null) await db.delete(usersTable).where(eq(usersTable.id, userId));
  const roleIds = [staleRoleId, currentRoleId].filter((id): id is number => id != null);
  if (roleIds.length) await db.delete(rolesTable).where(eq(rolesTable.id, roleIds[0]!));
  if (roleIds.length > 1) await db.delete(rolesTable).where(eq(rolesTable.id, roleIds[1]!));
  await pool.end();
});

test("request permissions use the user's current primary role, not a stale JWT role", async () => {
  const roles = await db.insert(rolesTable).values([
    { nameJson: { en: `${runId} stale` }, permissionsJson: permissions(true) },
    { nameJson: { en: `${runId} current` }, permissionsJson: permissions(false) },
  ]).returning({ id: rolesTable.id });
  staleRoleId = roles[0]!.id;
  currentRoleId = roles[1]!.id;
  const [user] = await db.insert(usersTable).values({
    email: `${runId}@example.invalid`,
    firstName: "Role",
    lastName: "Context",
    passwordHash: null,
    roleId: staleRoleId,
  }).returning({ id: usersTable.id });
  userId = user.id;
  await db.insert(userRolesTable).values({ userId, roleId: staleRoleId });
  const staleToken = signToken({ userId, roleId: staleRoleId });

  // This models an administrator changing the user's primary role after the
  // token was issued. The stale role is no longer in the user_roles join table.
  await db.update(usersTable).set({ roleId: currentRoleId }).where(eq(usersTable.id, userId));
  await db.delete(userRolesTable).where(eq(userRolesTable.userId, userId));
  await db.insert(userRolesTable).values({ userId, roleId: currentRoleId });

  server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/permission-context`, {
    headers: { authorization: `Bearer ${staleToken}` },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { roleIds: [currentRoleId], tags: false });
});