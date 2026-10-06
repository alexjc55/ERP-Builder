import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, pool, usersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { APP_SECRET } from "../lib/secret";
import { signToken, verifyToken } from "../lib/jwt";
import { matchesSessionAccounts } from "../lib/user-sessions";

test("session revocation HTTP and database regressions (isolated schema)", { timeout: 120_000 }, async (t) => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development", "Development database only");
  assert.equal(process.env.NODE_ENV, "test", "Explicit test mode required");
  const schema = `session_test_${randomBytes(8).toString("hex")}`;
  // Hold the bootstrap connection; all subsequent pooled clients use the isolated schema.
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const { default: auth } = await import("./auth");
    const { default: users } = await import("./users");
    const { requireAuth } = await import("../middlewares/auth");
    const { encryptSecret, decryptSecret } = await import("../lib/crypto");
    const { requireSuperAdmin } = await import("../middlewares/permissions");
    const app = express();
    app.use(express.json());
    app.use("/api", auth, users);
    app.get("/api/probe", requireAuth, (_req, res) => res.json({ ok: true }));
    app.get("/api/admin-probe", requireAuth, requireSuperAdmin(), (_req, res) => res.json({ ok: true }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const request = async (path: string, token?: string, data?: unknown) => {
      const response = await fetch(base + path, {
        method: data === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    const adminCaps = {
      pages: false, entities: false, roles: false, users: false, translations: false,
      events: false, modules: false, automations: false, customFilters: false,
      columnGroups: false, googleDrive: false, settings: false, dataImport: false,
    };
    const [adminRole] = await db.insert(rolesTable).values({
      nameJson: { en: "Session test admin" },
      permissionsJson: { superAdmin: true, admin: adminCaps, pageIds: [], records: {} },
    }).returning();
    const [ordinaryRole] = await db.insert(rolesTable).values({
      nameJson: { en: "Session test user" },
      permissionsJson: { superAdmin: false, admin: adminCaps, pageIds: [], records: {} },
    }).returning();
    const initialPassword = `test-${randomBytes(16).toString("hex")}`;
    const passwordHash = await bcrypt.hash(initialPassword, 4);
    const accounts = await db.insert(usersTable).values([
      { email: "admin@session-test.invalid", firstName: "Test", lastName: "Admin", roleId: adminRole!.id, passwordHash },
      { email: "user@session-test.invalid", firstName: "Test", lastName: "User", roleId: ordinaryRole!.id, passwordHash },
      { email: "guest@session-test.invalid", firstName: "Test", lastName: "Guest", roleId: ordinaryRole!.id },
    ]).returning();
    const [admin, user, guest] = accounts;
    const login = async (account: typeof admin, password = initialPassword) => {
      const result = await request("/auth/login", undefined, { email: account!.email, password });
      assert.equal(result.status, 200);
      assert.equal(typeof result.body.token, "string");
      return result.body.token as string;
    };
    let adminToken = await login(admin);
    let userToken = await login(user);
    const protectedSecret = encryptSecret("non-secret encryption regression fixture");

    await t.test("reject legacy, malformed and wrong-algorithm JWTs", async () => {
      const legacy = jwt.sign({ userId: admin!.id, roleId: adminRole!.id }, APP_SECRET, { expiresIn: "7d" });
      assert.equal((await request("/probe", legacy)).status, 401);
      assert.equal(verifyToken(jwt.sign({ userId: admin!.id, roleId: adminRole!.id, sessionVersion: 0 }, APP_SECRET, { algorithm: "HS384", expiresIn: "7d" })), null);
      assert.equal(verifyToken(jwt.sign({ userId: "1", roleId: 1, sessionVersion: 0 }, APP_SECRET, { expiresIn: "7d" })), null);
      assert.equal((await request("/probe", adminToken)).status, 200);
      assert.equal((await request("/probe")).status, 401);
    });
    await t.test("ordinary and guest users cannot revoke every account", async () => {
      assert.equal((await request("/auth/revoke-all-sessions", userToken, {})).status, 403);
      const guestToken = signToken({ userId: guest!.id, roleId: ordinaryRole!.id, guest: true, sessionVersion: 0 });
      assert.equal((await request("/auth/revoke-sessions", guestToken, {})).status, 403);
      assert.equal((await request("/auth/revoke-all-sessions", "agk_invalid-test-key", {})).status, 401);
    });
    await t.test("own revocation immediately invalidates old token; login still works", async () => {
      assert.equal((await request("/auth/revoke-sessions", userToken, {})).status, 200);
      assert.equal((await request("/probe", userToken)).status, 401);
      userToken = await login(user);
      assert.equal((await request("/probe", userToken)).status, 200);
      assert.equal((await request("/probe", adminToken)).status, 200);
    });
    await t.test("wrong password leaves session alive; password change revokes it", async () => {
      assert.equal((await request("/auth/change-password", userToken, { currentPassword: "wrong", newPassword: "valid-new-password" })).status, 400);
      assert.equal((await request("/probe", userToken)).status, 200);
      assert.equal((await request("/auth/change-password", userToken, { currentPassword: initialPassword, newPassword: "valid-new-password" })).status, 200);
      assert.equal((await request("/probe", userToken)).status, 401);
      assert.equal((await request("/auth/login", undefined, { email: user!.email, password: initialPassword })).status, 401);
      userToken = await login(user, "valid-new-password");
    });
    await t.test("admin password reset invalidates target, not admin", async () => {
      assert.equal((await request(`/users/${user!.id}/reset-password`, adminToken, { newPassword: "reset-new-password" })).status, 200);
      assert.equal((await request("/probe", userToken)).status, 401);
      assert.equal((await request("/probe", adminToken)).status, 200);
      userToken = await login(user, "reset-new-password");
    });
    await t.test("impersonation binds both accounts and cannot renew revoked admin", async () => {
      const impersonated = await request("/auth/impersonate", adminToken, { userId: user!.id });
      assert.equal(impersonated.status, 200);
      const token = impersonated.body.token;
      assert.equal((await request("/probe", token)).status, 200);
      assert.equal((await request("/auth/revoke-sessions", token, {})).status, 403);
      assert.equal((await request("/auth/revoke-sessions", adminToken, {})).status, 200);
      assert.equal((await request("/probe", token)).status, 401);
      assert.equal((await request("/auth/stop-impersonation", token, {})).status, 401);
      adminToken = await login(admin);
      const next = await request("/auth/impersonate", adminToken, { userId: user!.id });
      assert.equal((await request("/auth/revoke-sessions", userToken, {})).status, 200);
      assert.equal((await request("/probe", next.body.token)).status, 401);
      userToken = await login(user, "reset-new-password");
    });
    await t.test("global revocation affects all JWTs and preserves encryption", async () => {
      const guestToken = signToken({ userId: guest!.id, roleId: ordinaryRole!.id, guest: true });
      assert.equal((await request("/auth/revoke-all-sessions", adminToken, {})).status, 200);
      for (const token of [adminToken, userToken, guestToken]) assert.equal((await request("/probe", token)).status, 401);
      assert.equal(decryptSecret(protectedSecret), "non-secret encryption regression fixture");
      adminToken = await login(admin);
      assert.equal((await request("/admin-probe", adminToken)).status, 200);
    });
    await t.test("live state rejects blocked/deleted accounts and missing impersonators", async () => {
      assert.equal(matchesSessionAccounts({ userId: 1, roleId: 1, sessionVersion: 2 }, [{ id: 1, sessionVersion: 2, isActive: false }]), false);
      assert.equal(matchesSessionAccounts({ userId: 1, roleId: 1, sessionVersion: 2 }, []), false);
      assert.equal(matchesSessionAccounts({ userId: 1, roleId: 1, sessionVersion: 2, impersonatorId: 2, impersonatorSessionVersion: 0 }, [{ id: 1, sessionVersion: 2, isActive: true }]), false);
      await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, admin!.id));
      assert.equal((await request("/probe", adminToken)).status, 401);
    });
  } finally {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release();
    await pool.end();
  }
});
