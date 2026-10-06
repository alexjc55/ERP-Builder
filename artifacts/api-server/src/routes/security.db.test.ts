import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { db, pool, rolesTable, usersTable, securityEventsTable, securityEventReviewsTable, NO_ACCESS_PERMS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/jwt";
import { securityAuditContext, securityAuditStart, flushSecurityAudit, securityTokenRef, classifySecurityRequest } from "../lib/security-audit";
import { createSecurityIpResolver } from "../lib/security-ip";
import { requireAuth } from "../middlewares/auth";
import { requireSuperAdmin } from "../middlewares/permissions";

test("IP attribution rejects spoofed chains and trusts only configured hops", () => {
  const resolve = createSecurityIpResolver("127.0.0.1/32").resolve;
  assert.equal(resolve("8.8.8.8", "1.1.1.1").clientIp, "8.8.8.8");
  assert.equal(resolve("::ffff:127.0.0.1", "1.1.1.1, 8.8.8.8").clientIp, "8.8.8.8");
  assert.equal(resolve("127.0.0.1", "not-an-ip").ipSource, "invalid-forwarded-ignored");
  assert.throws(() => createSecurityIpResolver("0.0.0.0/0"));
  assert.equal(classifySecurityRequest("/api/inbound-integrations/2/regenerate-secret", "POST").critical, true);
  assert.equal(classifySecurityRequest("/api/google-drive/oauth/callback", "GET").critical, true);
});

test("security evidence HTTP and database boundaries", { timeout: 120000 }, async (t) => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  assert.equal(process.env.NODE_ENV, "test");
  const schema = `security_test_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    await db.insert(rolesTable).values([
      { id: 1001, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true } },
      { id: 1002, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS } },
    ]);
    const password = "security-fixture-password";
    await db.insert(usersTable).values([
      { id: 1001, email: "admin@security.invalid", firstName: "Test", lastName: "", roleId: 1001, passwordHash: await bcrypt.hash(password, 10) },
      { id: 1002, email: "user@security.invalid", firstName: "Test", lastName: "", roleId: 1002 },
    ]);
    const app = express();
    app.use(securityAuditContext, express.json(), securityAuditStart);
    app.use((await import("./auth")).default);
    app.use((await import("./security")).default);
    app.post("/users", requireAuth, requireSuperAdmin(), (_req, res) => res.json({ id: 2001, passwordHash: "NEVER-STORE-HASH" }));
    let rotations = 0;
    app.post("/ai-agents/:id/regenerate-key", requireAuth, requireSuperAdmin(), (_req, res) => {
      rotations++; res.json({ apiKey: "NEVER-STORE-AGENT-KEY" });
    });
    app.get("/probe", requireAuth, (_req, res) => res.json({ ok: true }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const base = `http://127.0.0.1:${addr.port}`;
    const request = async (path: string, token?: string, body?: unknown) => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json() as Record<string, any>;
      await flushSecurityAudit();
      return { status: response.status, data, requestId: response.headers.get("x-request-id") };
    };
    let token = "";
    await t.test("failed login reason is private; successful login and later actions share safe session reference", async () => {
      const bad = await request("/auth/login", undefined, { email: "admin@security.invalid", password: "NEVER-STORE-PASSWORD" });
      assert.equal(bad.status, 401);
      assert.equal(bad.data.error, "Invalid credentials");
      const signed = await request("/auth/login", undefined, { email: "admin@security.invalid", password });
      assert.equal(signed.status, 200); token = signed.data.token;
      const changed = await request("/users", token, { password: "NEVER-STORE-PASSWORD", roleIds: [1001], arbitrary: "NEVER-STORE-ARBITRARY" });
      assert.equal(changed.status, 200);
      const rows = await db.select().from(securityEventsTable);
      assert.ok(rows.some((r) => r.reason === "password_mismatch"));
      const created = rows.find((r) => r.action === "user.create" && r.outcome === "success")!;
      assert.equal(created.actorUserId, 1001); assert.equal(created.targetUserId, 2001);
      assert.equal(created.sessionRef, securityTokenRef(token)); assert.equal(created.isAlert, true);
      assert.equal(rows.find((r) => r.action === "auth.login" && r.outcome === "success")!.sessionRef, created.sessionRef);
      const encoded = JSON.stringify(rows);
      for (const secret of [password, "NEVER-STORE-PASSWORD", "NEVER-STORE-HASH", "NEVER-STORE-ARBITRARY", token]) assert.ok(!encoded.includes(secret));
      assert.ok(created.requestId && changed.requestId === created.requestId);
    });
    await t.test("ordinary, guest, impersonated users cannot access evidence; malformed filters are rejected", async () => {
      assert.equal((await request("/security/summary", signToken({ userId: 1002, roleId: 1002 }))).status, 403);
      assert.equal((await request("/security/summary", signToken({ userId: 1001, roleId: 1001, guest: true }))).status, 403);
      assert.equal((await request("/security/summary", signToken({ userId: 1001, roleId: 1001, impersonatorId: 1001, impersonatorSessionVersion: 0 }))).status, 403);
      assert.equal((await request("/security/events/query", token, { limit: 99999 })).status, 400);
      const page = await request("/security/events/query", token, { actorUserId: 1001, sessionRef: securityTokenRef(token), limit: 2 });
      assert.equal(page.status, 200); assert.equal(page.data.data.length, 2);
      assert.ok(page.data.data.every((row: { actorUserId: number }) => row.actorUserId === 1001));
    });
    await t.test("acknowledgment is separate, idempotent and cannot delete evidence", async () => {
      const [event] = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "user.create")).orderBy(securityEventsTable.id);
      const all = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "user.create"));
      const alert = all.find((row) => row.isAlert)!; assert.ok(alert);
      const before = (await request("/security/summary", token)).data.unreviewedAlerts;
      assert.equal((await request(`/security/events/${alert.id}/review`, token, {})).status, 200);
      assert.equal((await request(`/security/events/${alert.id}/review`, token, {})).status, 200);
      assert.equal((await db.select().from(securityEventReviewsTable)).length, 1);
      assert.equal((await request("/security/summary", token)).data.unreviewedAlerts, before - 1);
      assert.deepEqual((await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, event!.id)))[0], event);
    });
    await t.test("repeated failed login followed by success is highlighted", async () => {
      for (let i = 0; i < 5; i++) await request("/auth/login", undefined, { email: "admin@security.invalid", password: "wrong-fixture-password" });
      await request("/auth/login", undefined, { email: "admin@security.invalid", password });
      const rows = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "auth.login"));
      assert.ok(rows.some((r) => r.outcome === "denied" && r.isAlert));
      assert.ok(rows.some((r) => r.outcome === "success" && r.isAlert));
      assert.notEqual(signToken({ userId: 1, roleId: 1 }), signToken({ userId: 1, roleId: 1 }));
    });
    await t.test("key rotation retains the target, not the key; missing audit storage prevents the operation", async () => {
      assert.equal((await request("/ai-agents/91/regenerate-key", token, {})).status, 200);
      const page = await request("/security/events/query", token, { agentId: 91 });
      assert.equal(page.data.total, 2);
      assert.ok(page.data.data.every((r: { detailsJson: Record<string, unknown> }) => r.detailsJson.targetAgentId === 91));
      assert.ok(!JSON.stringify(page.data).includes("NEVER-STORE-AGENT-KEY"));
      assert.equal(rotations, 1);
      await bootstrap.query(`ALTER TABLE "${schema}".security_events RENAME TO security_events_unavailable`);
      try {
        assert.equal((await request("/ai-agents/91/regenerate-key", token, {})).status, 503);
        assert.equal(rotations, 1);
      } finally {
        await flushSecurityAudit();
        await bootstrap.query(`ALTER TABLE "${schema}".security_events_unavailable RENAME TO security_events`);
      }
    });
  } finally {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await flushSecurityAudit();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release(); await pool.end();
  }
});
