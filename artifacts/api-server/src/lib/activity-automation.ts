import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, isNull, inArray, asc, sql } from "drizzle-orm";
import {
  db, entityAutomationsTable, entityAutomationRunsTable, entityRecordsTable, entityFieldsTable,
  recordActivityTable as entries, activityTasksTable as tasks, activityNotificationsTable as notifications,
  activityRuleSchedulesTable as schedules, activityRuleStatesTable as states,
  automationTriggerSchema, type AutomationTrigger, type AutomationAction, type EntityAutomation,
} from "@workspace/db";
import { activityEnabled, eligibleAssignee } from "./activity-access";
import { nextActivityCheck } from "./activity-schedule";
import { logger } from "./logger";
import { runOne } from "./automations-engine";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Monitor = Extract<AutomationTrigger, { type: "inactivity" | "status_age" | "task_due" }>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const HOUR = 3_600_000;

export async function runActivityAction(action: Extract<AutomationAction, { type: "notify" | "create_task" }>, context: {
  entityId: number; recordId: number; automationId: number; activityTaskId?: number;
  notificationKey: string; actionIndex: number;
}) {
  if (!await activityEnabled(context.entityId)) throw new Error("Активность для сущности отключена");
  const [record] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, context.recordId));
  if (!record || record.archivedAt) return 0;
  const people = new Set(action.userIds);
  const fields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, context.entityId), eq(entityFieldsTable.fieldType, "user"), eq(entityFieldsTable.isActive, true)));
  for (const key of action.userFieldKeys) {
    if (!fields.some(f => f.fieldKey === key)) throw new Error(`Поле получателя недоступно: ${key}`);
    const value = (record.valuesJson as Record<string, unknown>)[key];
    for (const item of Array.isArray(value) ? value : [value]) if (Number.isSafeInteger(Number(item)) && Number(item) > 0) people.add(Number(item));
  }
  if (action.taskAssignee && context.activityTaskId) {
    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, context.activityTaskId), eq(tasks.recordId, record.id)));
    if (task) people.add(task.assigneeId);
  }
  let count = 0;
  for (const userId of people) {
    const access = await eligibleAssignee(userId, record.entityId, record.id);
    if (!access) continue; // role/row/status revocations are respected at delivery and again on read
    if (action.type === "notify") {
      const rows = await db.insert(notifications).values({ userId, entityId: record.entityId, recordId: record.id,
        pageId: access.pageId, message: action.message,
        dedupeKey: `automation:${context.automationId}:record:${context.recordId}:${context.notificationKey}:${context.actionIndex}`,
      }).onConflictDoNothing().returning({ id: notifications.id });
      count += rows.length;
    } else {
      const dueAt = new Date(Date.now() + action.dueInHours * HOUR);
      await db.transaction(async tx => {
        const [task] = await tx.insert(tasks).values({
          entityId: record.entityId, recordId: record.id, pageId: access.pageId,
          title: action.title, description: action.description, kind: action.kind, dueAt, assigneeId: userId,
          automationId: context.automationId, actionKey: `${context.actionIndex}:${hash(action)}`,
        }).onConflictDoNothing().returning();
        if (!task) return;
        count++;
        await tx.insert(entries).values({ entityId: record.entityId, recordId: record.id, taskId: task.id,
          kind: "task_created", body: `${action.title}\n${dueAt.toISOString()}` });
      });
    }
  }
  return count;
}

/** Separate from record.updated: changing a note never pretends the record was edited. */
export async function dispatchActivityEvent(type: "activity_logged" | "task_completed", entityId: number, recordId: number, actorId: number, taskId?: number) {
  try {
    const rules = await db.select().from(entityAutomationsTable).where(and(eq(entityAutomationsTable.entityId, entityId), eq(entityAutomationsTable.isActive, true)));
    for (const rule of rules) {
      const trigger = automationTriggerSchema.safeParse(rule.triggerJson);
      if (trigger.success && trigger.data.type === type)
        await runOne(rule, trigger.data, entityId, recordId, actorId, type, `activity:${randomUUID()}`, { taskId });
    }
  } catch (error) {
    logger.error({ err: error, entityId, recordId }, "Activity automation event failed");
  }
}
export async function claimActivitySchedule(rule: EntityAutomation, trigger: AutomationTrigger, now: Date) {
  if (!("schedule" in trigger) || !trigger.schedule) return true; // old date triggers retain their cadence
  const schedule = trigger.schedule, configHash = hash([rule.triggerJson, rule.conditionsJson, rule.conditionConjunction, rule.actionsJson]);
  return db.transaction(async tx => {
    const initialAt = ["day", "month"].includes(schedule.frequency) ? nextActivityCheck(schedule, new Date(now.getTime() - 1000)) : now;
    await tx.insert(schedules).values({ automationId: rule.id, configHash, nextCheckAt: initialAt }).onConflictDoNothing();
    const [state] = await tx.select().from(schedules).where(eq(schedules.automationId, rule.id)).for("update");
    if (state.configHash !== configHash) {
      await tx.update(schedules).set({ configHash, nextCheckAt: initialAt }).where(eq(schedules.automationId, rule.id));
      if (initialAt > now) return false;
    } else if (state.nextCheckAt > now) return false;
    await tx.update(schedules).set({ nextCheckAt: nextActivityCheck(schedule, now) }).where(eq(schedules.automationId, rule.id));
    return true;
  });
}

async function monitorAnchor(tx: Tx, trigger: Monitor, recordId: number, taskId: number | undefined, now: Date) {
  const [record] = await tx.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId)).for("update");
  if (!record || record.archivedAt || !await activityEnabled(record.entityId, tx)) return null;
  if (trigger.type === "task_due") {
    if (!taskId) return null;
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.recordId, recordId)));
    if (!task || task.status !== "open" || task.dueAt.getTime() + trigger.offsetMinutes * 60_000 > now.getTime()) return null;
    return `${task.id}:${task.dueAt.toISOString()}`;
  }
  let since = record.statusChangedAt ?? record.createdAt;
  if (trigger.type === "inactivity") {
    if (trigger.baseline === "created") since = record.createdAt;
    const [latest] = await tx.select({ at: sql<Date | null>`max(${entries.occurredAt})` }).from(entries).where(and(
      eq(entries.recordId, recordId), eq(entries.deleted, false), inArray(entries.kind, trigger.kinds),
      trigger.successfulOnly ? eq(entries.outcome, "successful") : undefined));
    if (latest?.at && new Date(latest.at) > since) since = new Date(latest.at);
    if (trigger.skipWithFutureTask) {
      const [planned] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.recordId, recordId), eq(tasks.status, "open"), gt(tasks.dueAt, now))).limit(1);
      if (planned) return null;
    }
  }
  return since.getTime() + trigger.days * 24 * HOUR <= now.getTime() ? `${record.statusId ?? "none"}:${since.toISOString()}` : null;
}
async function claimMonitor(rule: EntityAutomation, trigger: Monitor, recordId: number, taskId: number | undefined, now: Date) {
  return db.transaction(async tx => {
    const [currentRule] = await tx.select().from(entityAutomationsTable).where(eq(entityAutomationsTable.id, rule.id));
    if (!currentRule?.isActive || hash([currentRule.triggerJson, currentRule.conditionsJson, currentRule.actionsJson, currentRule.conditionConjunction]) !== hash([rule.triggerJson, rule.conditionsJson, rule.actionsJson, rule.conditionConjunction])) return null;
    const point = await monitorAnchor(tx, trigger, recordId, taskId, now);
    const subjectKey = taskId ? `task:${taskId}` : "record";
    const stateWhere = and(eq(states.automationId, rule.id), eq(states.recordId, recordId), eq(states.subjectKey, subjectKey));
    if (!point) {
      await tx.delete(states).where(stateWhere);
      return null;
    }
    const anchor = hash([point, rule.triggerJson, rule.conditionsJson, rule.actionsJson, rule.conditionConjunction]);
    await tx.insert(states).values({ automationId: rule.id, recordId, subjectKey, anchor }).onConflictDoNothing();
    const [state] = await tx.select().from(states).where(stateWhere).for("update");
    const same = state.anchor === anchor;
    const count = same ? state.runCount : 0;
    if (count > 0 && (!trigger.repeatHours || (trigger.maxRuns != null && count >= trigger.maxRuns)
      || (state.lastFiredAt && state.lastFiredAt.getTime() + trigger.repeatHours * HOUR > now.getTime()))) return null;
    const dedupeKey = `monitor:${state.id}:${anchor}:${count + 1}`;
    const [claim] = await tx.insert(entityAutomationRunsTable).values({ automationId: rule.id, entityId: rule.entityId, recordId,
      status: "error", triggerName: trigger.type, dedupeKey,
      detailJson: { reason: "Execution claimed; if this remains, execution was interrupted and requires review" },
    }).onConflictDoNothing().returning({ id: entityAutomationRunsTable.id });
    if (!claim) return null;
    await tx.update(states).set({ anchor, runCount: count + 1, lastFiredAt: now }).where(eq(states.id, state.id));
    return dedupeKey;
  });
}

export async function runActivityRule(rule: EntityAutomation, trigger: Monitor, now: Date) {
  if (!await activityEnabled(rule.entityId) || !await claimActivitySchedule(rule, trigger, now)) return;
  let cursor = 0;
  // Keyset batches keep memory bounded; only the configured rule's entity is examined.
  for (;;) {
    const candidates = trigger.type === "task_due"
      ? await db.select({ id: tasks.id, recordId: tasks.recordId }).from(tasks).where(and(eq(tasks.entityId, rule.entityId), eq(tasks.status, "open"), gt(tasks.id, cursor),
          lte(tasks.dueAt, new Date(now.getTime() - trigger.offsetMinutes * 60_000)))).orderBy(asc(tasks.id)).limit(100)
      : await db.select({ id: entityRecordsTable.id, recordId: entityRecordsTable.id }).from(entityRecordsTable).where(and(eq(entityRecordsTable.entityId, rule.entityId), isNull(entityRecordsTable.archivedAt),
          gt(entityRecordsTable.id, cursor))).orderBy(asc(entityRecordsTable.id)).limit(100);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      const taskId = trigger.type === "task_due" ? candidate.id : undefined;
      // Pre-check timing to avoid constructing formula/page contexts for not-due records.
      const eligible = await db.transaction(tx => monitorAnchor(tx, trigger, candidate.recordId, taskId, now));
      if (!eligible) continue;
      await runOne(rule, trigger, rule.entityId, candidate.recordId, null, trigger.type, null, {
        taskId,
        claim: () => claimMonitor(rule, trigger, candidate.recordId, taskId, now),
        conditionsFalse: async () => {
          await db.delete(states).where(and(eq(states.automationId, rule.id), eq(states.recordId, candidate.recordId), eq(states.subjectKey, taskId ? `task:${taskId}` : "record")));
        },
      });
    }
    cursor = candidates[candidates.length - 1].id;
  }
}

/** Exact task reminders use indexed due rows, not a full record scan. */
export async function runActivityReminders(now = new Date()) {
  const candidates = await db.select({ id: tasks.id, recordId: tasks.recordId }).from(tasks).where(and(eq(tasks.status, "open"), isNull(tasks.reminderSentAt), lte(tasks.reminderAt, now))).orderBy(asc(tasks.reminderAt)).limit(200);
  for (const candidate of candidates) await db.transaction(async tx => {
    // Same record→task lock order as interactive task changes.
    const [record] = await tx.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, candidate.recordId)).for("update");
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, candidate.id)).for("update");
    if (!task || task.status !== "open" || task.reminderSentAt || !task.reminderAt || task.reminderAt > now) return;
    if (record && !record.archivedAt && await activityEnabled(task.entityId, tx)
      && await eligibleAssignee(task.assigneeId, task.entityId, task.recordId, undefined, tx)) {
      await tx.insert(notifications).values({ userId: task.assigneeId, entityId: task.entityId, recordId: task.recordId,
        message: `${task.title} — ${task.dueAt.toISOString()}`, dedupeKey: `task-reminder:${task.id}:${task.version}`,
      }).onConflictDoNothing();
    }
    // Denied recipients must not keep monopolizing every sweep. No information is delivered.
    await tx.update(tasks).set({ reminderSentAt: now }).where(eq(tasks.id, task.id));
  });
}

export async function recordStatusActivity(event: { entityId: number | null; recordId: number | null; payloadJson: unknown }) {
  if (!event.entityId || !event.recordId || !await activityEnabled(event.entityId)) return;
  const data = (event.payloadJson ?? {}) as Record<string, unknown>;
  // Do not copy historical field values/status names: their current permissions
  // can differ from the moment of the event.
  await db.insert(entries).values({ entityId: event.entityId, recordId: event.recordId,
    actorId: typeof data.actorUserId === "number" ? data.actorUserId : null,
    kind: "status_changed", body: "Статус записи изменён" });
}
