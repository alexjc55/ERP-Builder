import { test } from "node:test";
import assert from "node:assert/strict";
import { recordHref, fromLocalInput, toLocalInput, taskDraftError, taskDraftToInput, dueState } from "./activity.ts";
import { applyMonitor, buildRecipientAction, emptyMonitor, emptyRecipients, monitorFromTrigger } from "./activityAutomation.ts";

test("recordHref maps recordId to the table deep-link param", () => {
  assert.equal(recordHref("/orders?recordId=12"), "/orders?record=12");
  assert.equal(recordHref("/orders?tab=a&recordId=5"), "/orders?tab=a&record=5");
  assert.equal(recordHref("/orders"), "/orders");
  assert.equal(recordHref("https://evil.example/x"), null);
  assert.equal(recordHref("//evil"), null);
  assert.equal(recordHref(null), null);
});

test("datetime-local round trip", () => {
  const iso = fromLocalInput("2030-05-06T10:30");
  assert.ok(iso);
  assert.equal(toLocalInput(iso), "2030-05-06T10:30");
  assert.equal(fromLocalInput(""), null);
});

test("task draft validation and payload", () => {
  const d = { title: " Call back ", description: "", kind: "call" as const, due: "2030-01-01T09:00", assigneeId: "7", reminder: "" };
  assert.equal(taskDraftError({ ...d, title: " " }), "title");
  assert.equal(taskDraftError({ ...d, due: "" }), "due");
  assert.equal(taskDraftError({ ...d, assigneeId: "" }), "assignee");
  assert.equal(taskDraftError(d), null);
  const p = taskDraftToInput({ ...d, reminder: "15" }, { entityId: 1, recordId: 2, pageId: null });
  assert.equal(p.title, "Call back");
  assert.equal(p.reminderMinutes, 15);
  assert.equal(p.assigneeId, 7);
  assert.equal("pageId" in p, false);
  assert.equal(taskDraftToInput(d, { entityId: 1, recordId: 2 }).reminderMinutes, null);
});

test("dueState", () => {
  const now = new Date("2030-01-10T12:00:00");
  assert.equal(dueState("2030-01-09T12:00:00", "open", now), "overdue");
  assert.equal(dueState("2030-01-10T18:00:00", "open", now), "today");
  assert.equal(dueState("2030-01-12T18:00:00", "open", now), "upcoming");
  assert.equal(dueState("2030-01-09T12:00:00", "completed", now), "done");
});

test("monitor triggers carry schedule, repeats and options", () => {
  const m = { ...emptyMonitor(), frequency: "day" as const, hour: "8", repeatHours: "24", maxRuns: "3", days: "5" };
  const trig: Record<string, unknown> & { type: string } = { type: "inactivity" };
  assert.equal(applyMonitor(trig, m), null);
  assert.deepEqual(trig.schedule, { frequency: "day", hour: 8, day: 1, timezone: "Asia/Jerusalem" });
  assert.equal(trig.repeatHours, 24);
  assert.equal(trig.maxRuns, 3);
  assert.equal(trig.days, 5);
  assert.deepEqual(trig.kinds, ["call", "email", "meeting"]);
  assert.equal(applyMonitor({ type: "inactivity" }, { ...m, kinds: [] }), "kinds");
  assert.equal(applyMonitor({ type: "status_age" }, { ...m, days: "" }), "days");
  assert.equal(applyMonitor({ type: "status_age" }, { ...m, repeatHours: "0" }), "repeatHours");
  const once: Record<string, unknown> & { type: string } = { type: "status_age" };
  applyMonitor(once, { ...m, repeatHours: "", maxRuns: "" });
  assert.equal(once.repeatHours, null);
  assert.equal(once.maxRuns, null);
});

test("task_due offset sign and round trip", () => {
  const t: Record<string, unknown> & { type: string } = { type: "task_due" };
  applyMonitor(t, { ...emptyMonitor(), offsetDir: "before", offsetAmount: "2", offsetUnit: "hours" });
  assert.equal(t.offsetMinutes, -120);
  const back = monitorFromTrigger({ type: "task_due", offsetMinutes: -120 });
  assert.equal(back.offsetDir, "before");
  assert.equal(back.offsetUnit, "hours");
  assert.equal(back.offsetAmount, "2");
});

test("regular triggers get no schedule; date_reached optional", () => {
  const r: Record<string, unknown> & { type: string } = { type: "record_created" };
  applyMonitor(r, { ...emptyMonitor(), scheduleOn: true });
  assert.equal(r.schedule, undefined);
  const d1: Record<string, unknown> & { type: string } = { type: "date_reached" };
  applyMonitor(d1, emptyMonitor());
  assert.equal(d1.schedule, undefined);
  assert.equal(d1.repeatHours, undefined);
  const d2: Record<string, unknown> & { type: string } = { type: "date_reached" };
  applyMonitor(d2, { ...emptyMonitor(), scheduleOn: true });
  assert.ok(d2.schedule);
});

test("recipient actions validate inputs", () => {
  const base = emptyRecipients();
  assert.deepEqual(buildRecipientAction("notify", { ...base, message: "x" }, "inactivity"), { ok: false, error: "recipients" });
  assert.deepEqual(buildRecipientAction("notify", { ...base, userIds: [1] }, "inactivity"), { ok: false, error: "message" });
  assert.deepEqual(buildRecipientAction("notify", { ...base, taskAssignee: true, message: "x" }, "inactivity"), { ok: false, error: "taskAssigneeTrigger" });
  const ok = buildRecipientAction("notify", { ...base, taskAssignee: true, message: " ping " }, "task_due");
  assert.ok(ok.ok && ok.action.message === "ping" && ok.action.taskAssignee === true);
  assert.deepEqual(buildRecipientAction("create_task", { ...base, userFieldKeys: ["owner"] }, "status_age"), { ok: false, error: "title" });
  const ct = buildRecipientAction("create_task", { ...base, userFieldKeys: ["owner"], title: "Follow up", dueInHours: "48" }, "status_age");
  assert.ok(ct.ok && ct.action.dueInHours === 48 && ct.action.kind === "call");
});

test("card layout accepts the activity block kind", async () => {
  const { parseCardLayout, layoutHasActivity, makeBlock } = await import("./cardLayout.ts");
  const b = makeBlock("activity");
  assert.equal(b.span, 3);
  const l = parseCardLayout({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 1, blocks: [b] }] }] });
  assert.ok(l);
  assert.equal(layoutHasActivity(l), true);
  assert.equal(layoutHasActivity(null), false);
});
