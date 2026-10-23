import { Router } from "express";
import { z } from "zod/v4";
import { and, eq, desc, asc, lt, gte, lte, inArray, sql } from "drizzle-orm";
import { db, activitySettingsTable, recordActivityTable as entries, activityTasksTable as tasks, activityNotificationsTable as notifications, entityRecordsTable, usersTable, appSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import { ActivityError, activityAccess, activityEnabled, eligibleAssignee, humanUserWhere } from "../lib/activity-access";
import { dispatchActivityEvent } from "../lib/activity-automation";
import { invalidateEntityTables } from "../lib/collaboration";

const router = Router();
const id = z.coerce.number().int().positive();
const page = id.nullable().optional();
const scope = z.object({ entityId: id, recordId: id, pageId: page });
const timestamp = z.string().datetime({ offset: true });
const outcome = z.enum(["successful", "attempted", "none"]);
const taskInput = scope.extend({
  title: z.string().trim().min(1).max(500), description: z.string().max(10000).default(""),
  kind: z.enum(["call", "email", "meeting", "task"]), dueAt: timestamp,
  assigneeId: id, reminderMinutes: z.number().int().min(0).max(43200).nullable().optional(),
});
const activityInput = scope.extend({
  kind: z.enum(["call", "email", "meeting", "note"]), body: z.string().trim().min(1).max(10000),
  outcome: outcome.default("none"), occurredAt: timestamp.optional(), nextTask: taskInput.optional(),
});
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Errors are intentionally explicit and never silently interpreted as empty data.
router.use((req, res, next) => {
  // Router is mounted globally, so no effect on unrelated routes.
  if (!/^\/(record-activity|activity-(tasks|settings|assignees|notifications))(\/|$)/.test(req.path)) { next("router"); return; }
  next();
});
router.use(requireAuth);
router.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT") res.on("finish", () => {
    const entityId = (req as any).activityEntityId;
    if (res.statusCode < 300 && typeof entityId === "number") void invalidateEntityTables(entityId);
  });
  next();
});

async function access(req: any, entityId: number, recordId: number, pageId?: number | null, tx?: Tx, write = false) {
  const result = await activityAccess(req, entityId, recordId, pageId, tx);
  if (!result) throw new ActivityError(404, "Запись недоступна");
  if (write && (!result.canWrite || !await activityEnabled(entityId, tx))) throw new ActivityError(403, "Активность отключена или нет права изменения записи");
  req.activityEntityId = entityId;
  return result;
}
async function lockRecord(tx: Tx, recordId: number) {
  await tx.select({ id: entityRecordsTable.id }).from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId)).for("update");
}
async function taskCreate(tx: Tx, input: z.infer<typeof taskInput>, actorId: number) {
  if (!await eligibleAssignee(input.assigneeId, input.entityId, input.recordId, undefined, tx))
    throw new ActivityError(400, "Ответственный должен иметь доступ к записи и быть активным пользователем");
  const dueAt = new Date(input.dueAt);
  const [row] = await tx.insert(tasks).values({ ...input, dueAt, creatorId: actorId,
    reminderAt: input.reminderMinutes == null ? null : new Date(dueAt.getTime() - input.reminderMinutes * 60_000),
  }).returning();
  await tx.insert(entries).values({ entityId: input.entityId, recordId: input.recordId, taskId: row.id, actorId, kind: "task_created",
    body: `${input.title}\n${dueAt.toISOString()}\n${input.description}` });
  return row;
}
async function entryDto(row: typeof entries.$inferSelect, userId: number, canWrite: boolean, superAdmin: boolean) {
  const [user] = row.actorId ? await db.select().from(usersTable).where(eq(usersTable.id, row.actorId)) : [];
  return { ...row, actorName: user ? `${user.firstName} ${user.lastName}`.trim() : "Система",
    canAmend: canWrite && !row.deleted && ["call", "email", "meeting", "note"].includes(row.kind) && (row.actorId === userId || superAdmin) };
}
async function taskDto(req: any, row: typeof tasks.$inferSelect, pageId?: number | null) {
  const context = await activityAccess(req, row.entityId, row.recordId, pageId ?? undefined);
  if (!context || !await activityEnabled(row.entityId)) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, row.assigneeId));
  return { ...row, assigneeName: user ? `${user.firstName} ${user.lastName}`.trim() : "—",
    canManage: !req.user.guest && !context.record.archivedAt && (context.canWrite || row.assigneeId === req.user.userId),
    recordLabel: context.recordLabel, recordUrl: context.recordUrl };
}
router.get("/activity-settings", async (req, res) => {
  const entityId = id.parse(req.query.entityId);
  res.json({ entityId, enabled: await activityEnabled(entityId) });
});
router.post("/activity-settings", requireAdmin("entities"), async (req, res) => {
  const body = z.object({ entityId: id, enabled: z.boolean() }).parse(req.body);
  await db.insert(activitySettingsTable).values(body).onConflictDoUpdate({ target: activitySettingsTable.entityId, set: { enabled: body.enabled } });
  await invalidateEntityTables(body.entityId);
  res.json(body);
});
router.get("/record-activity", async (req, res) => {
  const query = scope.extend({ beforeId: id.optional() }).parse(req.query);
  const ctx = await access(req, query.entityId, query.recordId, query.pageId);
  const enabled = await activityEnabled(query.entityId);
  const rows = enabled ? await db.select().from(entries).where(and(eq(entries.recordId, query.recordId),
    query.beforeId ? lt(entries.id, query.beforeId) : undefined)).orderBy(desc(entries.id)).limit(51) : [];
  res.json({ enabled, canWrite: ctx.canWrite && enabled, items: await Promise.all(rows.slice(0, 50).map(r => entryDto(r, req.user!.userId, ctx.canWrite, ctx.perms.superAdmin))),
    nextBeforeId: rows.length > 50 ? rows[49].id : null });
});
router.post("/record-activity", async (req, res) => {
  const body = activityInput.parse(req.body);
  if (body.occurredAt && new Date(body.occurredAt).getTime() > Date.now() + 60_000) throw new ActivityError(400, "Будущее действие нужно запланировать как задачу");
  const result = await db.transaction(async tx => {
    await lockRecord(tx, body.recordId);
    const ctx = await access(req, body.entityId, body.recordId, body.pageId, tx, true);
    const [entry] = await tx.insert(entries).values({ entityId: body.entityId, recordId: body.recordId, actorId: req.user!.userId,
      kind: body.kind, body: body.body, outcome: body.kind === "note" ? "none" : body.outcome,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date() }).returning();
    if (body.nextTask) {
      if (body.nextTask.entityId !== body.entityId || body.nextTask.recordId !== body.recordId) throw new ActivityError(400, "Следующее действие должно относиться к этой записи");
      await taskCreate(tx, { ...body.nextTask, pageId: body.pageId }, req.user!.userId);
    }
    return { entry, ctx };
  });
  await dispatchActivityEvent("activity_logged", body.entityId, body.recordId, req.user!.userId);
  res.status(201).json(await entryDto(result.entry, req.user!.userId, result.ctx.canWrite, result.ctx.perms.superAdmin));
});
router.put("/record-activity/:id", async (req, res) => {
  const entryId = id.parse(req.params.id);
  const body = z.object({ expectedVersion: id, action: z.enum(["edit", "delete"]), reason: z.string().trim().min(1).max(1000),
    body: z.string().trim().min(1).max(10000).optional(), pageId: page }).parse(req.body);
  const [old] = await db.select().from(entries).where(eq(entries.id, entryId));
  if (!old) throw new ActivityError(404, "Событие не найдено");
  const result = await db.transaction(async tx => {
    await lockRecord(tx, old.recordId);
    const ctx = await access(req, old.entityId, old.recordId, body.pageId, tx, true);
    const [current] = await tx.select().from(entries).where(eq(entries.id, entryId)).for("update");
    if (current.version !== body.expectedVersion || current.deleted) throw new ActivityError(409, "Событие уже изменено");
    if (!["call", "email", "meeting", "note"].includes(current.kind) || (!ctx.perms.superAdmin && current.actorId !== req.user!.userId))
      throw new ActivityError(403, "Можно исправлять только свои взаимодействия");
    if (body.action === "edit" && !body.body) throw new ActivityError(400, "Введите текст");
    const [row] = await tx.update(entries).set({ body: body.action === "edit" ? body.body : current.body,
      deleted: body.action === "delete", version: current.version + 1 }).where(eq(entries.id, entryId)).returning();
    await tx.insert(entries).values({ entityId: old.entityId, recordId: old.recordId, actorId: req.user!.userId,
      kind: body.action === "delete" ? "activity_deleted" : "activity_edited",
      body: `#${entryId}: ${body.reason}\n${current.body}${body.body ? `\n→ ${body.body}` : ""}` });
    return { row, ctx };
  });
  res.json(await entryDto(result.row, req.user!.userId, result.ctx.canWrite, result.ctx.perms.superAdmin));
});
router.get("/activity-assignees", async (req, res) => {
  const query = scope.parse(req.query);
  await access(req, query.entityId, query.recordId, query.pageId, undefined, true);
  const people = await db.select().from(usersTable).where(humanUserWhere).orderBy(asc(usersTable.id));
  const result = [];
  for (const person of people) if (await eligibleAssignee(person.id, query.entityId, query.recordId))
    result.push({ id: person.id, name: `${person.firstName} ${person.lastName}`.trim() });
  res.json(result);
});
router.post("/activity-tasks", async (req, res) => {
  const input = taskInput.parse(req.body);
  const row = await db.transaction(async tx => {
    await lockRecord(tx, input.recordId);
    await access(req, input.entityId, input.recordId, input.pageId, tx, true);
    return taskCreate(tx, input, req.user!.userId);
  });
  res.status(201).json(await taskDto(req, row, input.pageId));
});
router.get("/activity-tasks", async (req, res) => {
  const query = z.object({ entityId: id.optional(), recordId: id.optional(), pageId: page, offset: z.coerce.number().int().min(0).max(1000000).default(0),
    filter: z.enum(["open", "overdue", "today", "upcoming", "completed", "cancelled", "all"]).default("open") }).parse(req.query);
  if (!!query.entityId !== !!query.recordId) throw new ActivityError(400, "Укажите сущность и запись вместе");
  if (query.recordId) await access(req, query.entityId!, query.recordId, query.pageId);
  const now = new Date();
  const [settings] = await db.select({ zone: appSettingsTable.timeZone }).from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const zone = settings?.zone ?? "Asia/Jerusalem";
  const filterStatus = ["completed", "cancelled"].includes(query.filter) ? query.filter : "open";
  const rows = await db.select().from(tasks).where(and(
    query.recordId ? eq(tasks.recordId, query.recordId) : eq(tasks.assigneeId, req.user!.userId),
    query.filter === "all" ? undefined : eq(tasks.status, filterStatus),
    query.filter === "overdue" ? lt(tasks.dueAt, now) : undefined,
    query.filter === "today" ? sql`(${tasks.dueAt} AT TIME ZONE ${zone})::date = (${now.toISOString()}::timestamptz AT TIME ZONE ${zone})::date` : undefined,
    query.filter === "upcoming" ? sql`(${tasks.dueAt} AT TIME ZONE ${zone})::date > (${now.toISOString()}::timestamptz AT TIME ZONE ${zone})::date` : undefined,
  )).orderBy(asc(tasks.dueAt), asc(tasks.id)).limit(51).offset(query.offset);
  const items = [];
  // The UI can continue via nextOffset even if an entire page lost permissions.
  for (const row of rows.slice(0, 50)) {
    const item = await taskDto(req, row, query.pageId);
    if (item) items.push(item);
  }
  res.json({ items, nextOffset: rows.length > 50 ? query.offset + 50 : null });
});
router.put("/activity-tasks/:id", async (req, res) => {
  const taskId = id.parse(req.params.id);
  const body = z.object({ expectedVersion: id, action: z.enum(["complete", "reschedule", "cancel"]), dueAt: timestamp.optional(),
    result: z.string().max(10000).default(""), outcome: outcome.default("none"), pageId: page }).parse(req.body);
  const [old] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!old) throw new ActivityError(404, "Задача не найдена");
  const row = await db.transaction(async tx => {
    await lockRecord(tx, old.recordId);
    const ctx = await access(req, old.entityId, old.recordId, body.pageId, tx);
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (req.user!.guest || ctx.record.archivedAt || !await activityEnabled(old.entityId, tx)
      || (!ctx.canWrite && current.assigneeId !== req.user!.userId)) throw new ActivityError(403, "Нет права изменять задачу");
    if (current.version !== body.expectedVersion || current.status !== "open") throw new ActivityError(409, "Задача уже изменена. Обновите список");
    if (body.action === "complete" && !body.result.trim()) throw new ActivityError(400, "Укажите результат");
    if (body.action === "reschedule" && !body.dueAt) throw new ActivityError(400, "Укажите новый срок");
    const dueAt = body.action === "reschedule" ? new Date(body.dueAt!) : current.dueAt;
    const [updated] = await tx.update(tasks).set({
      status: body.action === "complete" ? "completed" : body.action === "cancel" ? "cancelled" : "open",
      result: body.result, dueAt, version: current.version + 1, updatedAt: new Date(),
      ...(body.action === "reschedule" ? { reminderSentAt: null, reminderAt: current.reminderMinutes == null ? null : new Date(dueAt.getTime() - current.reminderMinutes * 60_000) } : {}),
    }).where(eq(tasks.id, taskId)).returning();
    await tx.insert(entries).values({ entityId: current.entityId, recordId: current.recordId, actorId: req.user!.userId, taskId,
      kind: `task_${body.action === "complete" ? "completed" : body.action === "cancel" ? "cancelled" : "rescheduled"}`,
      body: `${current.title}\n${body.action === "reschedule" ? `${current.dueAt.toISOString()} → ${dueAt.toISOString()}\n` : ""}${body.result}` });
    if (body.action === "complete" && current.kind !== "task") await tx.insert(entries).values({
      entityId: current.entityId, recordId: current.recordId, actorId: req.user!.userId, taskId, kind: current.kind,
      body: body.result, outcome: body.outcome,
    });
    return updated;
  });
  if (body.action === "complete") {
    await dispatchActivityEvent("task_completed", row.entityId, row.recordId, req.user!.userId, row.id);
    if (row.kind !== "task") await dispatchActivityEvent("activity_logged", row.entityId, row.recordId, req.user!.userId);
  }
  res.json(await taskDto(req, row, body.pageId));
});
router.get("/activity-notifications", async (req, res) => {
  const offset = z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.offset);
  const rows = await db.select().from(notifications).where(eq(notifications.userId, req.user!.userId)).orderBy(desc(notifications.id)).limit(51).offset(offset);
  const items = [];
  for (const row of rows.slice(0, 50)) {
    const ctx = await activityAccess(req, row.entityId, row.recordId);
    if (ctx && await activityEnabled(row.entityId)) {
      const { dedupeKey: _, userId: __, ...safe } = row;
      items.push({ ...safe, recordLabel: ctx.recordLabel, recordUrl: ctx.recordUrl });
    }
  }
  res.json({ items, nextOffset: rows.length > 50 ? offset + 50 : null });
});
router.post("/activity-notifications/:id/read", async (req, res) => {
  const notificationId = id.parse(req.params.id);
  const [row] = await db.select().from(notifications).where(and(eq(notifications.id, notificationId), eq(notifications.userId, req.user!.userId)));
  if (!row || !await activityAccess(req, row.entityId, row.recordId)) throw new ActivityError(404, "Уведомление недоступно");
  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, row.id));
  res.sendStatus(204);
});
router.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof ActivityError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof z.ZodError) { res.status(400).json({ error: err.message }); return; }
  next(err);
});
export default router;
