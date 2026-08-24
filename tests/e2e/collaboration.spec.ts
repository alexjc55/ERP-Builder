import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  loginHistoryTable,
  NO_ACCESS_PERMS,
  pagesTable,
  rolesTable,
  usersTable,
} from "@workspace/db";

const runId = `${process.pid}-${Date.now()}`;
const path = `/__collaboration-e2e-${runId}`;
const password = `Collab-${runId}!`;
const emails = {
  a: `collab-a-${runId}@example.test`,
  b: `collab-b-${runId}@example.test`,
  restricted: `collab-restricted-${runId}@example.test`,
};

const fixture: {
  pageId: number;
  entityId: number;
  recordId: number;
  userIds: number[];
  roleIds: number[];
} = { pageId: 0, entityId: 0, recordId: 0, userIds: [], roleIds: [] };

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Пароль|Password/).fill(password);
  await page.getByRole("button", { name: /Войти|Sign in|Login/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(path);
  await expect(page.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
}

async function newSession(context: BrowserContext, email: string) {
  const page = await context.newPage();
  await login(page, email);
  return page;
}

test.beforeAll(async () => {
  const [page] = await db.insert(pagesTable).values({
    nameJson: { en: "Collaboration E2E", ru: "Collaboration E2E" },
    path,
    isActive: true,
  }).returning({ id: pagesTable.id });
  fixture.pageId = page!.id;
  const [entity] = await db.insert(entitiesTable).values({
    entityKey: `collaboration_e2e_${runId}`,
    nameJson: { en: "Collaboration E2E", ru: "Collaboration E2E" },
    pageId: page!.id,
  }).returning({ id: entitiesTable.id });
  fixture.entityId = entity!.id;
  const recordPerm = { view: true, create: true, update: true, delete: true, scope: "all" as const };
  const [openRole, restrictedRole] = await db.insert(rolesTable).values([
    {
      nameJson: { en: `Collaboration E2E open ${runId}` },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        pageIds: [page!.id],
        records: { [entity!.id]: recordPerm },
      },
    },
    {
      nameJson: { en: `Collaboration E2E restricted ${runId}` },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        pageIds: [page!.id],
        records: { [entity!.id]: recordPerm },
      },
    },
  ]).returning({ id: rolesTable.id });
  fixture.roleIds = [openRole!.id, restrictedRole!.id];
  await db.insert(entityFieldsTable).values({
    entityId: entity!.id,
    fieldKey: "collab_text",
    nameJson: { en: "Collaboration text", ru: "Collaboration text" },
    fieldType: "text",
    permissionsJson: { [String(restrictedRole!.id)]: "hidden" },
  });
  const [record] = await db.insert(entityRecordsTable).values({
    entityId: entity!.id,
    valuesJson: { collab_text: "seed" },
  }).returning({ id: entityRecordsTable.id });
  fixture.recordId = record!.id;
  const passwordHash = await bcrypt.hash(password, 4);
  const users = await db.insert(usersTable).values([
    { email: emails.a, passwordHash, firstName: "Alice", lastName: "Editor", roleId: openRole!.id, language: "en" },
    { email: emails.b, passwordHash, firstName: "Bob", lastName: "Editor", roleId: openRole!.id, language: "en" },
    { email: emails.restricted, passwordHash, firstName: "Restricted", lastName: "Viewer", roleId: restrictedRole!.id, language: "en" },
  ]).returning({ id: usersTable.id });
  fixture.userIds = users.map((user) => user.id);
});

test.afterAll(async () => {
  try {
    if (fixture.userIds.length > 0) {
      await db.delete(loginHistoryTable).where(inArray(loginHistoryTable.userId, fixture.userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, fixture.userIds));
    }
    if (fixture.entityId > 0) await db.delete(entitiesTable).where(eq(entitiesTable.id, fixture.entityId));
    if (fixture.pageId > 0) await db.delete(pagesTable).where(eq(pagesTable.id, fixture.pageId));
    if (fixture.roleIds.length > 0) await db.delete(rolesTable).where(inArray(rolesTable.id, fixture.roleIds));
  } finally {
    await pool.end();
  }
});

test("two sessions preserve conflicts, redact coordinates, and reconnect once", async ({ browser }) => {
  const [contextA, contextB, contextRestricted] = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const [alice, bob, restricted] = await Promise.all([
      newSession(contextA, emails.a),
      newSession(contextB, emails.b),
      newSession(contextRestricted, emails.restricted),
    ]);
    const aliceCell = alice.locator(
      `[data-testid="record-cell"][data-record-id="${fixture.recordId}"][data-field-key="collab_text"]`,
    );
    const bobCell = bob.locator(
      `[data-testid="record-cell"][data-record-id="${fixture.recordId}"][data-field-key="collab_text"]`,
    );

    await bobCell.click();
    await expect(alice.getByTestId("collab-avatar").filter({ has: alice.locator("text=BO") })).toBeVisible();
    await expect(alice.locator(
      `[data-testid="cell-collab-outline"][data-record-id="${fixture.recordId}"][data-field-key="collab_text"][data-state="editing"]`,
    )).toBeVisible();
    await expect(restricted.getByTestId("collab-avatar-list")).toBeVisible();
    await expect(restricted.getByTestId("cell-collab-outline")).toHaveCount(0);
    const restrictedSnapshot = await restricted.evaluate(async (pageId) => {
      const token = localStorage.getItem("erp_token");
      const controller = new AbortController();
      const response = await fetch(
        `/api/collaboration/pages/${pageId}/stream?clientId=restricted-payload-${crypto.randomUUID()}`,
        {
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("\n\n")) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
        if (done) break;
      }
      controller.abort();
      const block = buffer.slice(0, buffer.indexOf("\n\n"));
      const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5);
      return JSON.parse(data ?? "{}") as { presence?: Array<{ editing?: unknown }> };
    }, fixture.pageId);
    expect(restrictedSnapshot.presence?.length).toBeGreaterThan(0);
    expect(restrictedSnapshot.presence?.every((entry) => entry.editing === null)).toBe(true);

    await aliceCell.click();
    const aliceInput = alice.getByTestId("cell-editor-input");
    await aliceInput.fill("alice draft");
    const bobInput = bob.getByTestId("cell-editor-input");
    await bobInput.fill("bob wins first");
    await bobInput.press("Enter");
    await expect(bobCell).toContainText("bob wins first");

    await expect(aliceInput).toHaveValue("alice draft");
    const conflictResponse = alice.waitForResponse((response) =>
      response.url().endsWith(`/api/records/${fixture.recordId}`) &&
      response.request().method() === "PUT" &&
      response.status() === 409,
    );
    const conflictRefresh = alice.waitForResponse((response) =>
      response.url().includes(`/api/entities/${fixture.entityId}/records/query`) &&
      response.request().method() === "POST" &&
      response.status() === 200,
    );
    await aliceInput.press("Enter");
    const conflict = await conflictResponse;
    expect(conflict.request().postDataJSON()).toMatchObject({ expectedVersion: 1 });
    await expect(aliceInput).toHaveValue("alice draft");
    await conflictRefresh;
    const retryResponse = alice.waitForResponse((response) =>
      response.url().endsWith(`/api/records/${fixture.recordId}`) &&
      response.request().method() === "PUT" &&
      response.status() === 200,
    );
    await aliceInput.press("Enter");
    await retryResponse;
    await expect(aliceCell).toContainText("alice draft");

    // Let the successful retry's own cache invalidation settle before measuring
    // the independent reconnect refresh.
    await alice.waitForTimeout(1_000);
    let recordQueries = 0;
    alice.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes(`/api/entities/${fixture.entityId}/records/query`)) {
        recordQueries += 1;
      }
    });
    const beforeRefreshes = Number(await alice.getByTestId("collab-connection-status").getAttribute("data-reconnect-refreshes"));
    await alice.evaluate(async (pageId) => {
      const token = localStorage.getItem("erp_token");
      const clientId = sessionStorage.getItem("erp_client_id");
      const controller = new AbortController();
      const response = await fetch(
        `/api/collaboration/pages/${pageId}/stream?clientId=${encodeURIComponent(clientId ?? "")}`,
        {
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      await response.body?.getReader().read();
      controller.abort();
    }, fixture.pageId);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
    await expect.poll(async () => Number(
      await alice.getByTestId("collab-connection-status").getAttribute("data-reconnect-refreshes"),
    )).toBe(beforeRefreshes + 1);
    await expect.poll(() => recordQueries).toBe(1);
    await alice.waitForTimeout(1_500);
    expect(recordQueries).toBe(1);
  } finally {
    await Promise.all([contextA.close(), contextB.close(), contextRestricted.close()]);
  }
});