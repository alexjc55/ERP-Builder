// Pure draft <-> payload helpers for activity-aware automation triggers and the
// notify / create_task actions. Kept free of React and path aliases so it can
// be unit-tested with `node --experimental-strip-types`.

export type Frequency = "minute" | "hour" | "day" | "month";
export type ActivityKind = "call" | "email" | "meeting" | "note";
export const MONITOR_TRIGGERS = ["inactivity", "status_age", "task_due"] as const;
export const SCHEDULABLE_TRIGGERS = ["inactivity", "status_age", "task_due", "date_reached"] as const;
export const DEFAULT_TZ = "Asia/Jerusalem";

export const isMonitorTrigger = (t: string) => (MONITOR_TRIGGERS as readonly string[]).includes(t);
export const isSchedulableTrigger = (t: string) => (SCHEDULABLE_TRIGGERS as readonly string[]).includes(t);

export interface MonitorDraft {
  /** date_reached: whether an explicit check schedule is configured (optional). */
  scheduleOn: boolean;
  frequency: Frequency;
  hour: string;
  day: string;
  timezone: string;
  /** "" = run once. */
  repeatHours: string;
  /** "" = unlimited. */
  maxRuns: string;
  days: string;
  kinds: ActivityKind[];
  successfulOnly: boolean;
  baseline: "created" | "status";
  skipWithFutureTask: boolean;
  /** task_due: "before" | "after" + amount (minutes) -> signed offsetMinutes. */
  offsetDir: "before" | "after";
  offsetAmount: string;
  offsetUnit: "minutes" | "hours" | "days";
}

export function emptyMonitor(): MonitorDraft {
  return {
    scheduleOn: false, frequency: "hour", hour: "9", day: "1", timezone: DEFAULT_TZ,
    repeatHours: "", maxRuns: "", days: "3", kinds: ["call", "email", "meeting"], successfulOnly: false,
    baseline: "created", skipWithFutureTask: true, offsetDir: "before", offsetAmount: "60", offsetUnit: "minutes",
  };
}

interface TriggerLike {
  type: string;
  schedule?: { frequency: Frequency; hour: number; day: number; timezone: string };
  repeatHours?: number | null; maxRuns?: number | null; days?: number;
  kinds?: ActivityKind[]; successfulOnly?: boolean; baseline?: "created" | "status";
  skipWithFutureTask?: boolean; offsetMinutes?: number;
}

const UNIT: Record<MonitorDraft["offsetUnit"], number> = { minutes: 1, hours: 60, days: 1440 };

export function monitorFromTrigger(t: TriggerLike): MonitorDraft {
  const m = emptyMonitor();
  if (t.schedule) {
    m.scheduleOn = true;
    m.frequency = t.schedule.frequency;
    m.hour = String(t.schedule.hour);
    m.day = String(t.schedule.day);
    m.timezone = t.schedule.timezone || DEFAULT_TZ;
  }
  m.repeatHours = t.repeatHours == null ? "" : String(t.repeatHours);
  m.maxRuns = t.maxRuns == null ? "" : String(t.maxRuns);
  if (t.days != null) m.days = String(t.days);
  if (t.kinds) m.kinds = [...t.kinds];
  if (t.successfulOnly != null) m.successfulOnly = t.successfulOnly;
  if (t.baseline) m.baseline = t.baseline;
  if (t.skipWithFutureTask != null) m.skipWithFutureTask = t.skipWithFutureTask;
  if (t.offsetMinutes != null) {
    const abs = Math.abs(t.offsetMinutes);
    m.offsetDir = t.offsetMinutes < 0 ? "before" : "after";
    m.offsetUnit = abs !== 0 && abs % 1440 === 0 ? "days" : abs !== 0 && abs % 60 === 0 ? "hours" : "minutes";
    m.offsetAmount = String(abs / UNIT[m.offsetUnit]);
  }
  return m;
}

export type MonitorError = "frequency" | "hour" | "day" | "timezone" | "repeatHours" | "maxRuns" | "days" | "kinds" | "offset";

const posInt = (s: string) => /^\d+$/.test(s.trim()) && Number(s) >= 1;

/**
 * Write the schedule / repeat / type-specific options of `m` into `trigger`.
 * Returns the first invalid input or null. Regular triggers are untouched.
 */
export function applyMonitor(trigger: TriggerLike & Record<string, unknown>, m: MonitorDraft): MonitorError | null {
  const type = trigger.type;
  if (!isSchedulableTrigger(type)) return null;
  const monitor = isMonitorTrigger(type);
  if (monitor || m.scheduleOn) {
    const hour = Number(m.hour), day = Number(m.day);
    if (!["minute", "hour", "day", "month"].includes(m.frequency)) return "frequency";
    if ((m.frequency === "day" || m.frequency === "month") && !(Number.isInteger(hour) && hour >= 0 && hour <= 23 && m.hour.trim() !== "")) return "hour";
    if (m.frequency === "month" && !(Number.isInteger(day) && day >= 1 && day <= 28)) return "day";
    if (!m.timezone.trim()) return "timezone";
    trigger.schedule = {
      frequency: m.frequency,
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
      day: Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1,
      timezone: m.timezone.trim(),
    };
  }
  if (monitor) {
    if (m.repeatHours.trim() && !posInt(m.repeatHours)) return "repeatHours";
    if (m.maxRuns.trim() && !posInt(m.maxRuns)) return "maxRuns";
    trigger.repeatHours = m.repeatHours.trim() ? Number(m.repeatHours) : null;
    trigger.maxRuns = m.maxRuns.trim() ? Number(m.maxRuns) : null;
  }
  if (type === "inactivity" || type === "status_age") {
    const d = Number(m.days.replace(",", "."));
    if (!m.days.trim() || !Number.isFinite(d) || d < 0.01) return "days";
    trigger.days = d;
  }
  if (type === "inactivity") {
    if (m.kinds.length === 0) return "kinds";
    trigger.kinds = [...m.kinds];
    trigger.successfulOnly = m.successfulOnly;
    trigger.baseline = m.baseline;
    trigger.skipWithFutureTask = m.skipWithFutureTask;
  }
  if (type === "task_due") {
    const a = Number(m.offsetAmount);
    if (m.offsetAmount.trim() === "" || !Number.isInteger(a) || a < 0) return "offset";
    const minutes = a * UNIT[m.offsetUnit];
    trigger.offsetMinutes = m.offsetDir === "before" ? -minutes : minutes;
  }
  return null;
}

// ---- notify / create_task ----------------------------------------------------

export interface RecipientDraft {
  message: string;
  title: string;
  description: string;
  kind: "call" | "email" | "meeting" | "task";
  dueInHours: string;
  userIds: number[];
  userFieldKeys: string[];
  taskAssignee: boolean;
}
export function emptyRecipients(): RecipientDraft {
  return { message: "", title: "", description: "", kind: "call", dueInHours: "24", userIds: [], userFieldKeys: [], taskAssignee: false };
}
export type RecipientError = "message" | "title" | "dueInHours" | "recipients" | "taskAssigneeTrigger";

interface RecipientActionLike {
  message?: string; title?: string; description?: string; kind?: RecipientDraft["kind"]; dueInHours?: number;
  userIds?: number[]; userFieldKeys?: string[]; taskAssignee?: boolean;
}
export function recipientsFromAction(a: RecipientActionLike): RecipientDraft {
  const d = emptyRecipients();
  return {
    message: a.message ?? d.message,
    title: a.title ?? d.title,
    description: a.description ?? d.description,
    kind: a.kind ?? d.kind,
    dueInHours: a.dueInHours != null ? String(a.dueInHours) : d.dueInHours,
    userIds: [...(a.userIds ?? [])],
    userFieldKeys: [...(a.userFieldKeys ?? [])],
    taskAssignee: a.taskAssignee ?? false,
  };
}

/** Build a notify / create_task action or return the first validation error. */
export function buildRecipientAction(type: "notify" | "create_task", d: RecipientDraft, triggerType: string):
  { ok: true; action: Record<string, unknown> } | { ok: false; error: RecipientError } {
  const taskAssignee = triggerType === "task_due" && d.taskAssignee;
  if (d.taskAssignee && triggerType !== "task_due") return { ok: false, error: "taskAssigneeTrigger" };
  if (d.userIds.length === 0 && d.userFieldKeys.length === 0 && !taskAssignee) return { ok: false, error: "recipients" };
  const recipients = { userIds: [...d.userIds], userFieldKeys: [...d.userFieldKeys], taskAssignee };
  if (type === "notify") {
    if (!d.message.trim()) return { ok: false, error: "message" };
    return { ok: true, action: { type, message: d.message.trim(), ...recipients } };
  }
  if (!d.title.trim()) return { ok: false, error: "title" };
  const h = Number(d.dueInHours.replace(",", "."));
  if (!d.dueInHours.trim() || !Number.isFinite(h) || h < 0) return { ok: false, error: "dueInHours" };
  return { ok: true, action: { type, title: d.title.trim(), ...(d.description.trim() ? { description: d.description.trim() } : {}), kind: d.kind, dueInHours: h, ...recipients } };
}
