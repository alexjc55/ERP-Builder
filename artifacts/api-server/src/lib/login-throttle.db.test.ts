import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { reserveLoginAttempt } from "./login-throttle";
import express from "express";
import authRouter from "../routes/auth";
import { db, usersTable, rolesTable, NO_ACCESS_PERMS } from "@workspace/db";
import bcrypt from "bcryptjs";

test("shared atomic throttles, expiry, restart persistence, bounded cardinality", async () => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  assert.equal(process.env.NODE_ENV, "test");
  const schema = `login_test_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.query(`CREATE TABLE "${schema}".login_throttle (bucket text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL)`);
    const tables = await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'login_throttle'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const results = await Promise.all(Array.from({ length: 16 }, () => reserveLoginAttempt("192.0.2.1", "User@example.invalid")));
    assert.equal(results.filter((r) => r === 0).length, 8);
    assert.ok(await reserveLoginAttempt("192.0.2.1", " user@example.invalid ") > 0);
    assert.equal(await reserveLoginAttempt("192.0.2.2", "other@example.invalid"), 0);
    await pool.query("UPDATE login_throttle SET expires_at = now() - interval '1 second'");
    assert.equal(await reserveLoginAttempt("192.0.2.1", "user@example.invalid"), 0);
    await pool.query("TRUNCATE login_throttle");
    const ipResults = [];
    for (let i = 0; i < 35; i++) ipResults.push(await reserveLoginAttempt("192.0.2.3", `user${i}@example.invalid`));
    assert.equal(ipResults.filter((r) => r === 0).length, 30);
    await pool.query("TRUNCATE login_throttle");
    for (let i = 0; i < 40; i++) assert.equal(await reserveLoginAttempt(`192.0.2.${i}`, "target@example.invalid"), 0);
    assert.ok(await reserveLoginAttempt("198.51.100.1", "target@example.invalid") > 0);
    assert.equal(await reserveLoginAttempt("198.51.100.2", "unaffected@example.invalid"), 0);
    const data = await pool.query("SELECT bucket FROM login_throttle");
    assert.ok(data.rows.every((r) => !r.bucket.includes("@") && !r.bucket.includes("192.")));
    await pool.query("TRUNCATE login_throttle");
    await db.insert(rolesTable).values({ id: 10, nameJson: {}, permissionsJson: NO_ACCESS_PERMS });
    await db.insert(usersTable).values({ id: 10, email: "user@example.invalid", firstName: "Test", lastName: "",
      roleId: 10, passwordHash: await bcrypt.hash("test-password-only", 12) });
    const app = express(); app.use(express.json(), authRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const login = (password: string, forwarded = "198.51.100.1") => fetch(`http://127.0.0.1:${addr.port}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": forwarded },
      body: JSON.stringify({ email: "user@example.invalid", password }),
    });
    assert.equal((await login("test-password-only")).status, 200);
    for (let i = 0; i < 7; i++) assert.equal((await login("incorrect", `203.0.113.${i}`)).status, 401);
    const limited = await login("test-password-only");
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.ok(((await limited.json()) as { retryAfterSeconds: number }).retryAfterSeconds > 0);
    await pool.query("UPDATE login_throttle SET expires_at = now() - interval '1 second'");
    assert.equal((await login("test-password-only")).status, 200);
    await pool.query("DROP TABLE login_throttle");
    await assert.rejects(reserveLoginAttempt("192.0.2.1", "user@example.invalid"));
    assert.equal((await login("test-password-only")).status, 503);
  } finally {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);
    bootstrap.release();
    await pool.end();
  }
});
