import { expect, test, type Page, type Route } from "@playwright/test";

// Route-intercepted smoke tests for the activity module UI (My tasks, inbox,
// record ActivityPanel). Every /api request is fulfilled here; no real data.

const E = 890101, PAGE = 890201, ME = 1;
const ml = (en: string) => ({ en, ru: en, he: en });
const entities = [{ id: E, pageId: PAGE, entityKey: "act_clients", nameJson: ml("Clients"), isActive: true, allowNoStatus: true, defaultPageSize: 50 }];
const pages = [
  { id: PAGE, path: "/act-clients", nameJson: ml("Clients"), isActive: true, sortOrder: 0 },
  { id: PAGE + 1, path: "/my-tasks", nameJson: ml("Personal follow-ups"), icon: "star", isSystem: true, isActive: true, sortOrder: 10 },
];
const fields = [{ id: 1, entityId: E, fieldKey: "title", nameJson: ml("Title"), fieldType: "text", sortOrder: 1, isActive: true, showInTable: true, permissionsJson: {}, optionsJson: [], isRequired: false }];
const me = {
  id: ME, email: "act@example.test", firstName: "Dana", roleId: 1, roleIds: [1], language: "en", direction: "ltr", isActive: true,
  permissions: { superAdmin: false, pageIds: [PAGE], admin: {}, records: { [E]: { view: true, create: true, update: true, delete: false, scope: "all" } } },
};
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function task(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, entityId: E, recordId: 50, pageId: PAGE, title: `Call back ${id}`, kind: "call", dueAt: inHours(-2), assigneeId: ME,
    reminderMinutes: null, status: "open", version: 3, createdAt: inHours(-48), assigneeName: "Dana", canManage: true, result: "",
    recordLabel: "Client 50", recordUrl: `/act-clients?recordId=50`, ...extra,
  };
}

type Reply = (body: unknown, status?: number) => Promise<void>;
async function common(route: Route, path: string, reply: Reply): Promise<boolean> {
  if (path === "/api/auth/me") { await reply(me); return true; }
  if (path === "/api/pages") { await reply(pages); return true; }
  if (path === "/api/entities") { await reply(entities); return true; }
  if (path === `/api/entities/${E}`) { await reply(entities[0]); return true; }
  if (path === "/api/settings") { await reply({ defaultLanguage: "en", timeZone: "UTC" }); return true; }
  if (path === `/api/entities/${E}/fields`) { await reply(fields); return true; }
  if (path.includes("/collaboration/")) { await route.abort(); return true; }
  return false;
}

async function auth(page: Page) {
  await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-activity-ui"));
}

test("my tasks: complete a task and mark a notification read", async ({ page }) => {
  await auth(page);
  let t1 = task(71);
  let readAt: string | null = null;
  const writes: { method: string; path: string; body: any }[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply: Reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await common(route, path, reply)) return;
    if (path === "/api/activity-tasks/71" && req.method() === "PUT") {
      const body = req.postDataJSON(); writes.push({ method: "PUT", path, body });
      t1 = { ...t1, status: "completed", version: 4, result: body.result ?? "" };
      return reply(t1);
    }
    if (path === "/api/activity-tasks") {
      const filter = new URL(req.url()).searchParams.get("filter") ?? "open";
      const open = t1.status === "open";
      const items = filter === "completed" ? (open ? [] : [t1]) : filter === "all" ? [t1] : open ? [t1] : [];
      return reply({ items, nextOffset: null });
    }
    if (path === "/api/activity-notifications/9/read" && req.method() === "POST") {
      writes.push({ method: "POST", path, body: null }); readAt = new Date().toISOString();
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/activity-notifications") return reply({ items: [{ id: 9, entityId: E, recordId: 50, message: "Client silent for 7 days", createdAt: inHours(-1), readAt, recordLabel: "Client 50", recordUrl: "/act-clients?recordId=50" }], nextOffset: null });
    return reply([]);
  });

  await page.goto("/my-tasks");
  await expect(page.getByRole("heading", { name: "Personal follow-ups", exact: true })).toBeVisible();
  const taskLink = page.locator("nav a[href='/my-tasks']:visible");
  await expect(taskLink).toHaveCount(1);
  await expect(taskLink).toContainText("Personal follow-ups");
  await expect(taskLink.locator("svg.lucide-star")).toHaveCount(1);
  await expect(page.getByTestId("page-my-tasks")).toBeVisible();
  await expect(page.getByTestId("text-task-title-71")).toHaveText("Call back 71");
  // The record link points at the table deep-link format.
  await expect(page.getByTestId("link-task-record-71")).toHaveAttribute("href", /\/act-clients\?record=50$/);

  await page.getByTestId("button-task-complete-71").click();
  await expect(page.getByTestId("dialog-task-complete")).toBeVisible();
  await page.getByTestId("input-task-result").fill("Agreed on delivery date");
  await page.getByTestId("button-task-confirm").click();
  await expect(page.getByTestId("dialog-task-complete")).toHaveCount(0);
  expect(writes[0]).toMatchObject({ method: "PUT", body: { action: "complete", expectedVersion: 3, result: "Agreed on delivery date" } });
  await expect(page.getByTestId("task-row-71")).toHaveCount(0);

  const inbox = page.getByTestId("notification-inbox");
  await expect(inbox.getByTestId("notification-9")).toContainText("Client silent for 7 days");
  await expect(inbox.getByTestId("text-unread-count")).toHaveText("1");
  await inbox.getByTestId("button-notification-read-9").click();
  await expect(inbox.getByTestId("text-unread-count")).toHaveCount(0);
  expect(writes.some(w => w.path === "/api/activity-notifications/9/read")).toBe(true);
});

test("record card: log a call with a next task; deep link params are cleaned", async ({ page }) => {
  await auth(page);
  const record = { id: 50, entityId: E, statusId: null, valuesJson: { title: "Client 50" }, version: 2, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" };
  const entries: any[] = [
    { id: 298, entityId: E, recordId: 50, kind: "status_changed", body: "Статус записи изменён", outcome: "none",
      occurredAt: inHours(-4), createdAt: inHours(-4), actorName: "Dana", version: 1, deleted: false, canAmend: false,
      statusChange: { from: ml("New"), to: ml("In progress"), cleared: false } },
    { id: 299, entityId: E, recordId: 50, kind: "task_rescheduled", body: "Call tomorrow\n2031-05-04T10:30:00.000Z",
      outcome: "none", occurredAt: inHours(-3), createdAt: inHours(-3), actorName: "Dana", version: 1, deleted: false, canAmend: false,
      taskContext: { kind: "call", assigneeName: "Lior" } },
  ];
  const tasks: any[] = [];
  const posts: any[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply: Reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await common(route, path, reply)) return;
    if (path === "/api/card-templates/resolve") return reply({ template: null });
    if (path === `/api/entities/${E}/records/query`) return reply({ data: [record], total: 1, numericTotals: {} });
    if (path === "/api/records/50") return reply(record);
    if (path === "/api/activity-assignees") return reply([{ id: ME, name: "Dana" }, { id: 2, name: "Lior" }]);
    if (path === "/api/record-activity" && req.method() === "POST") {
      const body = req.postDataJSON(); posts.push(body);
      const entry = { id: 300 + posts.length - 1, entityId: E, recordId: 50, kind: body.kind, body: body.body, outcome: body.outcome ?? "none", occurredAt: new Date().toISOString(), createdAt: new Date().toISOString(), actorId: ME, actorName: "Dana", taskId: null, version: 1, deleted: false, canAmend: true };
      entries.unshift(entry);
      if (body.nextTask) tasks.push(task(400, { ...body.nextTask, version: 1 }));
      return reply(entry, 201);
    }
    if (path === "/api/record-activity") return reply({ enabled: true, canWrite: true, items: entries, nextBeforeId: null });
    if (path === "/api/activity-tasks") return reply({ items: tasks, nextOffset: null });
    if (path === "/api/activity-notifications") return reply({ items: [], nextOffset: null });
    if (path.endsWith("/statuses") || path.endsWith("/views") || path.endsWith("/relations")) return reply([]);
    return reply([]);
  });

  // Server-style deep link (`recordId`) opens the record and is removed from the URL.
  await page.goto("/act-clients?recordId=50&keep=1");
  const panel = page.getByTestId("activity-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("activity-entry-298")).toContainText("New → In progress");
  await expect(panel.getByTestId("activity-entry-298")).toContainText("Status changed");
  await expect(panel.getByTestId("activity-entry-298")).not.toContainText("status_changed");
  await expect(panel.getByTestId("activity-entry-299")).toContainText("Task rescheduled");
  await expect(panel.getByTestId("activity-entry-299")).toContainText("Lior");
  await expect(panel.getByTestId("activity-entry-299")).not.toContainText("T10:30:00.000Z");
  await expect(page).toHaveURL(/\/act-clients\?keep=1$/);
  await expect(panel.getByTestId("text-no-next-step")).toBeVisible();

  await panel.getByTestId("button-entry-kind-call").click();
  await panel.getByTestId("input-activity-body").fill("Discussed pricing, waiting for approval");
  await panel.getByTestId("checkbox-plan-next").click();
  await panel.getByTestId("composer-input-task-title").fill("Follow up on approval");
  await panel.getByTestId("composer-input-task-due").fill("2031-05-04T10:30");
  await panel.getByTestId("button-activity-submit").click();

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ entityId: E, recordId: 50, kind: "call", body: "Discussed pricing, waiting for approval", nextTask: { title: "Follow up on approval", assigneeId: ME, entityId: E, recordId: 50 } });
  await expect(panel.getByTestId("activity-entry-300")).toContainText("Discussed pricing");
  await expect(panel.getByTestId("text-task-title-400")).toHaveText("Follow up on approval");
  await expect(panel.getByTestId("text-no-next-step")).toHaveCount(0);
  await expect(panel.getByTestId("input-activity-body")).toHaveValue("");
});
