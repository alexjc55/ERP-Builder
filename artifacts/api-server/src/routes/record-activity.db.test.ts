import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, rolesTable, entitiesTable, entityRecordsTable, entityFieldsTable, entityAutomationsTable, activityTasksTable, activityNotificationsTable, NO_ACCESS_PERMS } from "@workspace/db";
import { signToken } from "../lib/jwt";
import { runActivityReminders, runActivityRule } from "../lib/activity-automation";
import { nextActivityCheck } from "../lib/activity-schedule";
import { automationTriggerSchema } from "@workspace/db";

test("record activities: permissions, atomic next action, history, CAS, reminders and repeat control", async t => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  assert.equal(process.env.NODE_ENV, "test");
  const schema = `activity_test_${randomBytes(8).toString("hex")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const { default: router } = await import("./record-activity");
    const [entity] = await db.insert(entitiesTable).values({ entityKey: "activity_test", nameJson: { ru: "CRM" } }).returning();
    await db.insert(entityFieldsTable).values([
      { entityId: entity.id, fieldKey: "owner", nameJson: {}, fieldType: "user" },
      { entityId: entity.id, fieldKey: "title", nameJson: {}, fieldType: "text" },
    ]);
    const [adminRole, workerRole] = await db.insert(rolesTable).values([
      { nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true } },
      { nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, records: { [entity.id]: { view: true, update: true, create: false, delete: false, scope: "own", scopeFieldKeys: ["owner"] } } } },
    ]).returning();
    const [admin, worker, stranger, technical] = await db.insert(usersTable).values([
      { email: "admin@test.invalid", firstName: "Admin", lastName: "", roleId: adminRole.id },
      { email: "worker@test.invalid", firstName: "Worker", lastName: "", roleId: workerRole.id },
      { email: "other@test.invalid", firstName: "Other", lastName: "", roleId: workerRole.id },
      { email: "inbound-abcdef@integrations.local", firstName: "Technical", lastName: "", roleId: adminRole.id },
    ]).returning();
    const since = new Date(Date.now() - 4 * 86400000);
    const [record] = await db.insert(entityRecordsTable).values({ entityId: entity.id, valuesJson: { owner: worker.id, title: "Customer" }, createdAt: since, statusChangedAt: since }).returning();
    const app = express(); app.use(express.json()); app.use(router);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(error) }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const call = async (path: string, data?: unknown, user = admin, method = data ? "POST" : "GET") => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { "content-type": "application/json", authorization: `Bearer ${signToken({ userId: user.id, roleId: user.roleId })}` },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
    };
    const scope = { entityId: entity.id, recordId: record.id };
    const query = `entityId=${entity.id}&recordId=${record.id}`;
    const task = { ...scope, title: "Call back", kind: "call", dueAt: new Date(Date.now() - 1000).toISOString(), assigneeId: worker.id, reminderMinutes: 15 };
    await t.test("disabled gate, record ownership and service-account exclusion", async () => {
      assert.equal((await call("/record-activity", { ...scope, kind: "call", body: "Called" }, worker)).status, 403);
      assert.equal((await call("/activity-settings", { entityId: entity.id, enabled: true })).status, 200);
      assert.equal((await call(`/record-activity?${query}`, undefined, stranger)).status, 404);
      const choices = await call(`/activity-assignees?${query}`);
      assert.ok(choices.body.some((p: any) => p.id === worker.id));
      assert.ok(!choices.body.some((p: any) => p.id === technical.id || p.id === stranger.id));
      const rejected = await call("/record-activity", { ...scope, kind: "call", body: "Must roll back", nextTask: { ...task, assigneeId: stranger.id } });
      assert.equal(rejected.status, 400);
      assert.equal((await call(`/record-activity?${query}`)).body.items.length, 0);
    });
    let taskId: number;
    await t.test("activity plus next task, durable reminder dedupe, CAS and immutable change history", async () => {
      const saved = await call("/record-activity", { ...scope, kind: "call", body: "Call tonight", outcome: "successful", nextTask: task }, worker);
      assert.equal(saved.status, 201);
      const list = await call("/activity-tasks", undefined, worker);
      taskId = list.body.items[0].id;
      await Promise.all([runActivityReminders(), runActivityReminders()]);
      assert.equal((await call("/activity-notifications", undefined, worker)).body.items.length, 1);
      const changed = await call(`/activity-tasks/${taskId}`, { expectedVersion: 1, action: "reschedule", dueAt: new Date(Date.now() + 3600000).toISOString(), result: "Client busy" }, worker, "PUT");
      assert.equal(changed.status, 200);
      assert.equal((await call(`/activity-tasks/${taskId}`, { expectedVersion: 1, action: "cancel" }, worker, "PUT")).status, 409);
      const completed = await call(`/activity-tasks/${taskId}`, { expectedVersion: 2, action: "complete", result: "Agreed", outcome: "successful" }, worker, "PUT");
      assert.equal(completed.body.status, "completed");
      const feed = (await call(`/record-activity?${query}`, undefined, worker)).body.items;
      assert.ok(feed.some((entry: any) => entry.kind === "task_rescheduled" && entry.body.includes("→")));
      assert.ok(feed.some((entry: any) => entry.kind === "call" && entry.body === "Agreed"));
      await db.update(entityRecordsTable).set({ valuesJson: { owner: stranger.id } }).where(eq(entityRecordsTable.id, record.id));
      assert.equal((await call("/activity-notifications", undefined, worker)).body.items.length, 0);
      assert.equal((await call("/activity-tasks?filter=all", undefined, worker)).body.items.length, 0);
      await db.update(entityRecordsTable).set({ valuesJson: { owner: worker.id } }).where(eq(entityRecordsTable.id, record.id));
    });
    await t.test("hourly checks do not send hourly repeats; state survives multiple workers", async () => {
      const trigger = automationTriggerSchema.parse({ type: "status_age", days: 2, schedule: { frequency: "hour" }, repeatHours: 24, maxRuns: 2 });
      assert.equal(trigger.type, "status_age"); if (trigger.type !== "status_age") return;
      const [rule] = await db.insert(entityAutomationsTable).values({ entityId: entity.id, nameJson: { ru: "Follow up" }, triggerJson: trigger,
        conditionsJson: [], actionsJson: [{ type: "notify", message: "No progress", userIds: [worker.id], userFieldKeys: [], taskAssignee: false }] }).returning();
      const now = new Date();
      await Promise.all([runActivityRule(rule, trigger, now), runActivityRule(rule, trigger, now)]);
      const count = async () => (await db.select().from(activityNotificationsTable).where(eq(activityNotificationsTable.message, "No progress"))).length;
      assert.equal(await count(), 1);
      await runActivityRule(rule, trigger, new Date(now.getTime() + 2 * 3600000)); assert.equal(await count(), 1);
      await runActivityRule(rule, trigger, new Date(now.getTime() + 25 * 3600000)); assert.equal(await count(), 2);
      await runActivityRule(rule, trigger, new Date(now.getTime() + 50 * 3600000)); assert.equal(await count(), 2);
    });
    await t.test("daily and monthly cadence respects local calendar", () => {
      const schedule = { frequency: "month" as const, hour: 9, day: 1, timezone: "Asia/Jerusalem" };
      assert.equal(nextActivityCheck(schedule, new Date("2026-10-02T00:00:00Z")).toISOString(), "2026-11-01T07:00:00.000Z");
    });
    await t.test("inactivity ignores field edits and notes, resets only for selected contacts", async () => {
      const [idle] = await db.insert(entityRecordsTable).values({ entityId: entity.id, valuesJson: { owner: worker.id },
        createdAt: since, statusChangedAt: since }).returning();
      const trigger = automationTriggerSchema.parse({ type: "inactivity", days: 2, kinds: ["call"], baseline: "created", schedule: { frequency: "hour" } });
      if (trigger.type !== "inactivity") throw new Error("Invalid trigger");
      const [rule] = await db.insert(entityAutomationsTable).values({ entityId: entity.id, nameJson: {},
        triggerJson: trigger, conditionsJson: [], actionsJson: [{ type: "notify", message: "Inactive", userIds: [worker.id], userFieldKeys: [] }] }).returning();
      const now = new Date();
      await call("/record-activity", { entityId: entity.id, recordId: idle.id, kind: "note", body: "Internal note" }, worker);
      await runActivityRule(rule, trigger, now);
      const count = async () => (await db.select().from(activityNotificationsTable).where(eq(activityNotificationsTable.message, "Inactive"))).length;
      assert.equal(await count(), 1);
      await runActivityRule(rule, trigger, new Date(now.getTime() + 3600000)); assert.equal(await count(), 1);
      await call("/record-activity", { entityId: entity.id, recordId: idle.id, kind: "call", body: "Talked", outcome: "successful" }, worker);
      await runActivityRule(rule, trigger, new Date(now.getTime() + 2 * 3600000)); assert.equal(await count(), 1);
      await runActivityRule(rule, trigger, new Date(now.getTime() + 3 * 86400000)); assert.equal(await count(), 3);
      // Both records have become inactive; each has its own notification dedupe identity.
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release(); await pool.end();
  }
});
