import type { AutomationTrigger } from "@workspace/db";
export type CheckSchedule = NonNullable<Extract<AutomationTrigger, { type: "date_reached" }>["schedule"]>;
function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}
function zonedDate(year: number, month: number, day: number, hour: number, timezone: string) {
  const target = Date.UTC(year, month - 1, day, hour);
  let time = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(time), timezone);
    const delta = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (!delta) break;
    time += delta;
  }
  return new Date(time);
}
/** Calendar cadence, not a scan of every ERP row every minute.
 * Days 1–28 deliberately avoid missing monthly runs in shorter months. */
export function nextActivityCheck(schedule: CheckSchedule, after: Date): Date {
  if (schedule.frequency === "minute") return new Date(after.getTime() + 60_000);
  if (schedule.frequency === "hour") return new Date(after.getTime() + 3_600_000);
  const p = localParts(after, schedule.timezone);
  let local = new Date(Date.UTC(p.year, p.month - 1, schedule.frequency === "month" ? schedule.day : p.day));
  for (let i = 0; i < 3; i++) {
    const next = zonedDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), schedule.hour, schedule.timezone);
    if (next.getTime() > after.getTime()) return next;
    if (schedule.frequency === "month") local.setUTCMonth(local.getUTCMonth() + 1);
    else local.setUTCDate(local.getUTCDate() + 1);
  }
  throw new Error("Unable to calculate next activity check");
}
