import { pgTable, serial, integer, boolean, text, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { entitiesTable } from "./entities";
import { entityRecordsTable } from "./records";
import { usersTable } from "./users";
import { entityAutomationsTable } from "./automations";

export const activitySettingsTable = pgTable("activity_settings", {
  entityId: integer("entity_id").primaryKey().references(() => entitiesTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
});
export const activityTasksTable = pgTable("activity_tasks", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull().references(() => entityRecordsTable.id, { onDelete: "cascade" }),
  pageId: integer("page_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  assigneeId: integer("assignee_id").notNull().references(() => usersTable.id),
  creatorId: integer("creator_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("open"),
  result: text("result").notNull().default(""),
  reminderMinutes: integer("reminder_minutes"),
  reminderAt: timestamp("reminder_at", { withTimezone: true }),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  automationId: integer("automation_id").references(() => entityAutomationsTable.id, { onDelete: "set null" }),
  actionKey: text("action_key"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("activity_tasks_record_idx").on(t.recordId, t.status, t.dueAt),
  index("activity_tasks_assignee_idx").on(t.assigneeId, t.status, t.dueAt),
  index("activity_tasks_reminder_idx").on(t.reminderAt).where(sql`${t.status} = 'open' AND ${t.reminderSentAt} IS NULL`),
  uniqueIndex("activity_tasks_rule_open_unique").on(t.automationId, t.recordId, t.assigneeId, t.actionKey).where(sql`${t.status} = 'open' AND ${t.automationId} IS NOT NULL`),
]);
export const recordActivityTable = pgTable("record_activity", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull().references(() => entityRecordsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => activityTasksTable.id, { onDelete: "set null" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  outcome: text("outcome").notNull().default("none"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deleted: boolean("deleted").notNull().default(false),
  version: integer("version").notNull().default(1),
}, t => [
  index("record_activity_feed_idx").on(t.recordId, t.id),
  index("record_activity_latest_idx").on(t.recordId, t.occurredAt, t.id).where(sql`NOT ${t.deleted}`),
  index("record_activity_contact_idx").on(t.recordId, t.kind, t.occurredAt).where(sql`NOT ${t.deleted}`),
]);
export const activityNotificationsTable = pgTable("activity_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull().references(() => entityRecordsTable.id, { onDelete: "cascade" }),
  pageId: integer("page_id"),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("activity_notifications_dedupe_idx").on(t.userId, t.dedupeKey),
  index("activity_notifications_user_idx").on(t.userId, t.id),
]);
export const activityRuleSchedulesTable = pgTable("activity_rule_schedules", {
  automationId: integer("automation_id").primaryKey().references(() => entityAutomationsTable.id, { onDelete: "cascade" }),
  configHash: text("config_hash").notNull(),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(),
});
export const activityRuleStatesTable = pgTable("activity_rule_states", {
  id: serial("id").primaryKey(),
  automationId: integer("automation_id").notNull().references(() => entityAutomationsTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull().references(() => entityRecordsTable.id, { onDelete: "cascade" }),
  subjectKey: text("subject_key").notNull(),
  anchor: text("anchor").notNull(),
  runCount: integer("run_count").notNull().default(0),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
}, t => [uniqueIndex("activity_rule_states_unique").on(t.automationId, t.recordId, t.subjectKey)]);
