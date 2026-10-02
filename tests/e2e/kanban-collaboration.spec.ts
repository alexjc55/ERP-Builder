import { expect, test, type Page, type Route } from "@playwright/test";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";
import {
  db, pool, pagesTable, entitiesTable, entityFieldsTable, entityRecordsTable,
  entityStatusesTable, entityTransitionsTable, viewsTable, rolesTable, usersTable,
  NO_ACCESS_PERMS, entityAutomationsTable, entityAutomationRunsTable,
  auditLogTable, systemEventsTable, loginHistoryTable,
} from "@workspace/db";

// Obtain independently with executeSql(environment:"development"):
// SELECT current_database() AS database,
// md5(coalesce(string_agg(id::text||':'||entity_key,',' ORDER BY id),'')) AS fingerprint FROM entities;
// Never synthesize the approving fingerprint from this process's connection.
const run = randomUUID();
const key = `kanban_collaboration_e2e_${run}`;
const path = `/__kanban-collaboration-${run}`;
const password = `Kanban-${run}!`;
const emails = [`kanban-a-${run}@example.test`, `kanban-b-${run}@example.test`];
let fixture: {
  entity: number; page: number; role: number; bobRole: number; users: number[];
  ready: number; working: number; done: number; records: number[]; automations: number[];
} | undefined;

async function guard(page: Page) {
  expect(process.env.NODE_ENV).not.toBe("production");
  expect(process.env.REPLIT_ENVIRONMENT).not.toBe("production");
  const endpoint = new URL(process.env.DATABASE_URL!);
  expect(endpoint.hostname).toBe("helium");
  expect(endpoint.pathname).toBe("/heliumdb");
  expect(process.env.KANBAN_E2E_DEV_FINGERPRINT, "Independently verified development identity required").toMatch(/^[a-f0-9]{32}$/);
  const result = await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`);
  expect(result.rows[0].database).toBe("heliumdb");
  expect(result.rows[0].fingerprint).toBe(process.env.KANBAN_E2E_DEV_FINGERPRINT);
  expect(test.info().project.use.baseURL).toBe("http://localhost:80");
  const [admin] = await db.select({ id: usersTable.id, roleId: usersTable.roleId }).from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
    .where(and(eq(usersTable.isActive, true), sql`${rolesTable.permissionsJson}->>'superAdmin' = 'true'`)).limit(1);
  expect(admin, "Local administrator needed for read-only running API identity check").toBeTruthy();
  const probe = await page.request.get("/api/entities", {
    headers: { Authorization: `Bearer ${signToken({ userId: admin.id, roleId: admin.roleId })}` },
  });
  expect(probe.ok()).toBe(true);
  const identity = (entity: { id: number; entityKey: string }) => `${entity.id}:${entity.entityKey}`;
  expect((await probe.json()).map(identity).sort())
    .toEqual((await db.select().from(entitiesTable)).map(identity).sort());
}

async function setup(independentRoles = false) {
  // Entire setup commits atomically; no partial fixture can escape on failure.
  fixture = await db.transaction(async tx => {
    const [page] = await tx.insert(pagesTable).values({ path, nameJson: { en: key } }).returning();
    const [entity] = await tx.insert(entitiesTable).values({ entityKey: key, pageId: page.id, nameJson: { en: key } }).returning();
    const entityId = entity.id;
    const [role] = await tx.insert(rolesTable).values({
      nameJson: { en: key }, permissionsJson: {
        ...NO_ACCESS_PERMS, pageIds: [page.id],
        records: { [entityId]: { view: true, create: false, update: true, delete: false, scope: "all" } },
      },
    }).returning();
    const [bobRole] = independentRoles ? await tx.insert(rolesTable).values({
      nameJson: { en: `${key}_bob` }, permissionsJson: role.permissionsJson,
    }).returning() : [role];
    const passwordHash = await bcrypt.hash(password, 4);
    const users = await tx.insert(usersTable).values(emails.map((email, i) => ({
      email, passwordHash, firstName: i ? "Bob" : "Alice", lastName: "Kanban",
      roleId: i ? bobRole.id : role.id, language: "en",
    }))).returning();
    await tx.insert(entityFieldsTable).values(["title", "summary", "workflow_mark"].map(fieldKey => ({
      entityId, fieldKey, nameJson: { en: fieldKey }, fieldType: "text",
    })));
    const statuses = await tx.insert(entityStatusesTable).values([
      { entityId, statusKey: "ready", nameJson: { en: "Ready" }, sortOrder: 0 },
      { entityId, statusKey: "working", nameJson: { en: "Working" }, sortOrder: 1 },
      { entityId, statusKey: "done", nameJson: { en: "Archived done" }, sortOrder: 2, isArchiveTrigger: true, archiveAfterDays: 0 },
    ]).returning();
    const [ready, working, done] = statuses.map(s => s.id);
    await tx.insert(entityTransitionsTable).values([working, done].map(toStatusId => ({
      entityId, fromStatusId: ready, toStatusId,
      actionsJson: [{ type: "set_field", fieldKey: "workflow_mark", value: "transition ran" }],
    })));
    const automations = await tx.insert(entityAutomationsTable).values([working, done].map(toStatusId => ({
      entityId, nameJson: { en: key },
      triggerJson: { type: "status_changed", toStatusId },
      actionsJson: [{ type: "set_field", fieldKey: "summary", value: "automation ran" }],
    }))).returning();
    await tx.insert(viewsTable).values({
      entityId, viewKey: "board", nameJson: { en: "Live board" }, isDefault: true,
      configJson: { viewType: "kanban", kanban: { titleField: "title", fields: ["summary", "workflow_mark"], showLabels: true, hideEmptyFields: true } },
    });
    const records = await tx.insert(entityRecordsTable).values([
      "Conflict card", "Observer card", "Archive card", "Pending success card", "Pending failure card", "Keep sentinel",
    ].map(title => ({ entityId, statusId: ready, valuesJson: { title, summary: "seed" } }))).returning();
    return {
      entity: entityId, page: page.id, role: role.id, bobRole: bobRole.id, users: users.map(u => u.id),
      ready, working, done, records: records.map(r => r.id), automations: automations.map(a => a.id),
    };
  });
}

async function cleanup() {
  try {
    if (!fixture) return;
    const f = fixture;
    await db.transaction(async tx => {
      await tx.delete(loginHistoryTable).where(inArray(loginHistoryTable.userId, f.users));
      await tx.delete(systemEventsTable).where(eq(systemEventsTable.entityId, f.entity));
      await tx.delete(auditLogTable).where(eq(auditLogTable.entityId, f.entity));
      await tx.delete(entitiesTable).where(eq(entitiesTable.id, f.entity));
      await tx.delete(pagesTable).where(eq(pagesTable.id, f.page));
      await tx.delete(usersTable).where(inArray(usersTable.id, f.users));
      await tx.delete(rolesTable).where(inArray(rolesTable.id, [f.role, f.bobRole]));
    });
    const tables = [
      [entitiesTable, entitiesTable.id, [f.entity]], [pagesTable, pagesTable.id, [f.page]],
      [usersTable, usersTable.id, f.users], [rolesTable, rolesTable.id, [f.role, f.bobRole]],
      [entityRecordsTable, entityRecordsTable.id, f.records],
      [entityAutomationsTable, entityAutomationsTable.id, f.automations],
    ] as const;
    for (const [table, id, ids] of tables) {
      expect(await db.select({ id }).from(table).where(inArray(id, [...ids])), `Cleanup of ${key}`).toHaveLength(0);
    }
    expect(await db.select().from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.entityId, f.entity))).toHaveLength(0);
    console.log("Kanban collaboration fixture cleanup verified: users, roles, page, entity, records, automations and runs removed");
  } finally {
    fixture = undefined;
  }
}

test.afterAll(async () => { await pool.end(); });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password|Пароль/).fill(password);
  await page.getByRole("button", { name: /Sign in|Login|Войти/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(path);
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
  await expect(page.getByTestId(`card-kanban-${fixture!.records[0]}`)).toBeVisible();
}

const lane = (page: Page, status: number) => page.getByTestId(`lane-kanban-s:${status}`);
const card = (page: Page, record: number) => page.getByTestId(`card-kanban-${record}`);
async function move(page: Page, record: number, destination: string) {
  await page.getByTestId(`button-actions-kanban-${record}`).click();
  await page.getByRole("menuitem", { name: destination, exact: true }).click();
}
function responseFor(page: Page, record: number) {
  return page.waitForResponse(response => response.url().endsWith(`/api/records/${record}`) && response.request().method() === "PUT");
}

// Timing barriers only: every request/response still reaches the real API.
// No API or SSE payload is mocked, fulfilled, rewritten or synthesized.
async function holdWrite(page: Page, record: number) {
  let release!: () => void;
  let arrived!: (route: Route) => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<Route>(resolve => { arrived = resolve; });
  const pattern = `**/api/records/${record}`;
  await page.route(pattern, async route => {
    if (route.request().method() !== "PUT") return route.continue();
    arrived(route);
    await gate;
    await route.continue();
  });
  return { seen, release, remove: () => page.unroute(pattern) };
}
async function stored(record: number) {
  return (await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, record)))[0];
}
async function apiMove(page: Page, record: number, statusId: number, expectedVersion: number) {
  const token = await page.evaluate(() => localStorage.getItem("erp_token"));
  const response = await page.request.put(`/api/records/${record}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { statusId, expectedVersion },
  });
  expect(response.status()).toBe(200);
}

test("real independent Kanban sessions: stale CAS, SSE lanes, transition effects and pending filter epochs", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const gates: Array<{ release: () => void }> = [];
  try {
    await guard(page); // All identity checks finish before the first write.
    await setup();
    const f = fixture!;
    const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
    // Chromium offline mode alone leaves an already-open SSE reader alive.
    // Retain native fetch/bytes, but expose cancellation of that real transport.
    await alice.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      let streamController: AbortController | undefined;
      Object.assign(window, { disconnectTestStream: () => streamController?.abort() });
      window.fetch = (input, init) => {
        if (String(input).includes("/collaboration/") && String(input).includes("/stream?")) {
          streamController = new AbortController();
          const signal = init?.signal
            ? AbortSignal.any([init.signal, streamController.signal])
            : streamController.signal;
          return nativeFetch(input, { ...init, signal });
        }
        return nativeFetch(input, init);
      };
    });
    await Promise.all([login(alice, emails[0]), login(bob, emails[1])]);
    const identities = await Promise.all([alice, bob].map(p => p.evaluate(() => ({
      token: localStorage.getItem("erp_token"), client: sessionStorage.getItem("erp_client_id"),
    }))));
    expect(identities[0].token).toBeTruthy();
    expect(identities[1].token).not.toBe(identities[0].token);
    expect(identities[0].client).toBeTruthy();
    expect(identities[1].client).not.toBe(identities[0].client);

    const [conflict, observer, archive, pendingSuccess, pendingFailure, keep] = f.records;
    const [aGate, bGate] = await Promise.all([holdWrite(alice, conflict), holdWrite(bob, conflict)]);
    gates.push(aGate, bGate);
    const [aResponse, bResponse] = [responseFor(alice, conflict), responseFor(bob, conflict)];
    await Promise.all([move(alice, conflict, "Archived done"), move(bob, conflict, "Working")]);
    const [aRequest, bRequest] = await Promise.all([aGate.seen, bGate.seen]);
    expect(aRequest.request().postDataJSON()).toMatchObject({ expectedVersion: 1, statusId: f.done });
    expect(bRequest.request().postDataJSON()).toMatchObject({ expectedVersion: 1, statusId: f.working });
    await expect(lane(alice, f.done).getByTestId(`card-kanban-${conflict}`)).toBeVisible();
    await expect(lane(bob, f.working).getByTestId(`card-kanban-${conflict}`)).toBeVisible();
    const pendingSseRefresh = alice.waitForResponse(response =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/entities/${f.entity}/records/query`) &&
      response.request().postDataJSON().statusIds?.includes(f.working) &&
      response.status() === 200);
    bGate.release(); // Deterministic winner, with both version-1 writes already pending.
    expect((await bResponse).status()).toBe(200);
    await expect.poll(async () => (await stored(conflict)).valuesJson).toMatchObject({
      workflow_mark: "transition ran", summary: "automation ran",
    });
    const winnerVersion = (await stored(conflict)).version;
    expect(winnerVersion).toBeGreaterThan(1);
    await pendingSseRefresh;
    // A same-query live refresh must not wipe Alice's pending optimistic overlay.
    await expect(lane(alice, f.done).getByTestId(`card-kanban-${conflict}`)).toBeVisible();
    aGate.release();
    const stale = await aResponse;
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "Record changed concurrently; please retry", currentVersion: winnerVersion });
    await expect(alice.getByText("Record changed concurrently; please retry", { exact: true })).toBeVisible();
    await Promise.all([aGate.remove(), bGate.remove()]);
    for (const p of [alice, bob]) {
      await expect(lane(p, f.done).getByTestId(`card-kanban-${conflict}`)).toHaveCount(0);
      await expect(lane(p, f.ready).getByTestId(`card-kanban-${conflict}`)).toHaveCount(0);
      await expect(lane(p, f.working).getByTestId(`card-kanban-${conflict}`)).toBeVisible();
      await expect(p.getByTestId(`text-lane-count-s:${f.ready}`)).toHaveText("5");
      await expect(p.getByTestId(`text-lane-count-s:${f.working}`)).toHaveText("1");
    }
    expect(await stored(conflict)).toMatchObject({ statusId: f.working, archivedAt: null });
    await expect.poll(async () => (await stored(conflict)).valuesJson).toMatchObject({
      workflow_mark: "transition ran", summary: "automation ran",
    });
    await expect.poll(async () => (await db.select().from(entityAutomationRunsTable)
      .where(and(eq(entityAutomationRunsTable.recordId, conflict), eq(entityAutomationRunsTable.status, "success")))).length).toBe(1);

    // No click/reload/local mutation on Alice: only Bob's actual SSE record.updated
    // invalidation can cause her board to move this independent card.
    const refreshedStatuses = new Set<number>();
    alice.on("request", request => {
      if (request.method() === "POST" && request.url().endsWith(`/api/entities/${f.entity}/records/query`)) {
        for (const status of request.postDataJSON().statusIds ?? []) refreshedStatuses.add(status);
      }
    });
    const observerResponse = responseFor(bob, observer);
    await move(bob, observer, "Working");
    expect((await observerResponse).status()).toBe(200);
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${observer}`)).toContainText("automation ran");
    await expect(lane(alice, f.ready).getByTestId(`card-kanban-${observer}`)).toHaveCount(0);
    await expect(alice.getByTestId(`text-lane-count-s:${f.ready}`)).toHaveText("4");
    await expect(alice.getByTestId(`text-lane-count-s:${f.working}`)).toHaveText("2");
    expect(refreshedStatuses.has(f.ready)).toBe(true);
    expect(refreshedStatuses.has(f.working)).toBe(true);

    const archiveResponse = responseFor(bob, archive);
    await move(bob, archive, "Archived done");
    expect((await archiveResponse).status()).toBe(200);
    await expect.poll(async () => (await stored(archive)).archivedAt !== null).toBe(true);
    await expect.poll(async () => (await stored(archive)).valuesJson).toMatchObject({
      workflow_mark: "transition ran", summary: "automation ran",
    });
    for (const p of [alice, bob]) {
      await expect(card(p, archive)).toHaveCount(0);
      await expect(p.getByTestId(`text-lane-count-s:${f.done}`)).toHaveText("0");
      await expect(p.getByTestId(`text-lane-count-s:${f.ready}`)).toHaveText("3");
    }

    for (const [record, fails] of [[pendingSuccess, false], [pendingFailure, true]] as const) {
      const search = alice.getByPlaceholder(/Search…|Search\.\.\.|Поиск…/);
      await search.fill("");
      await expect(card(alice, record)).toBeVisible();
      const gate = await holdWrite(alice, record);
      gates.push(gate);
      const response = responseFor(alice, record);
      await move(alice, record, "Working");
      expect((await gate.seen).request().postDataJSON()).toMatchObject({ expectedVersion: 1 });
      await expect(lane(alice, f.working).getByTestId(`card-kanban-${record}`)).toBeVisible();
      await search.fill("Keep sentinel");
      await expect(card(alice, keep)).toBeVisible();
      await expect(card(alice, record)).toHaveCount(0);
      if (fails) await apiMove(bob, record, f.working, 1);
      gate.release();
      expect((await response).status()).toBe(fails ? 409 : 200);
      await gate.remove();
      // Explicit settling window covers both late completion and debounced SSE.
      await alice.waitForTimeout(1_200);
      await expect(card(alice, record)).toHaveCount(0);
      await expect(alice.locator("[data-kanban-card]")).toHaveCount(1);
      await expect(alice.getByTestId(`text-lane-count-s:${f.ready}`)).toHaveText("1");
      await expect(alice.getByTestId(`text-lane-count-s:${f.working}`)).toHaveText("0");
      expect((await stored(record)).statusId).toBe(f.working);
    }
    // Fresh cards keep the reconnect scenarios independent of earlier filters.
    const reconnectRecords = await db.insert(entityRecordsTable).values(
      ["Reconnect moved", "Reconnect archived", "Reconnect pending", "Lost response card"].map(title => ({
        entityId: f.entity, statusId: f.ready, valuesJson: { title, summary: "seed" },
      })),
    ).returning();
    f.records.push(...reconnectRecords.map(record => record.id));
    const [reconnectMoved, reconnectArchived, reconnectPending, lostResponse] = reconnectRecords.map(record => record.id);
    await alice.getByPlaceholder(/Search…|Search\.\.\.|Поиск…/).fill("");
    await bob.reload();
    for (const p of [alice, bob]) {
      await expect(card(p, reconnectPending)).toBeVisible();
      await expect(p.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
    }
    const cdp = await contexts[0].newCDPSession(alice);
    await cdp.send("Network.enable");
    const network = async (offline: boolean) => {
      await cdp.send("Network.emulateNetworkConditions", {
        offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      });
      if (offline) await alice.evaluate(() =>
        (window as unknown as { disconnectTestStream: () => void }).disconnectTestStream());
    };
    const originalDocument = await alice.evaluate(() => performance.timeOrigin);
    const assertCounts = async () => {
      for (const status of [f.ready, f.working, f.done]) {
        const rows = await db.select({ id: entityRecordsTable.id }).from(entityRecordsTable)
          .where(and(eq(entityRecordsTable.entityId, f.entity), eq(entityRecordsTable.statusId, status),
            sql`${entityRecordsTable.archivedAt} IS NULL`));
        await expect(alice.getByTestId(`text-lane-count-s:${status}`)).toHaveText(String(rows.length));
      }
    };
    await network(true);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    await apiMove(bob, reconnectMoved, f.working, 1);
    await apiMove(bob, reconnectArchived, f.done, 1);
    await expect.poll(async () => (await stored(reconnectArchived)).archivedAt !== null).toBe(true);
    // Prove events were actually missed rather than received before disconnect.
    await expect(lane(alice, f.ready).getByTestId(`card-kanban-${reconnectMoved}`)).toBeVisible();
    await expect(card(alice, reconnectArchived)).toBeVisible();
    await network(false);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected", { timeout: 40_000 });
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${reconnectMoved}`)).toBeVisible();
    await expect(card(alice, reconnectArchived)).toHaveCount(0);
    await assertCounts();

    const reconnectGate = await holdWrite(alice, reconnectPending);
    gates.push(reconnectGate);
    const reconnectResponse = responseFor(alice, reconnectPending);
    await move(alice, reconnectPending, "Archived done");
    await reconnectGate.seen;
    await network(true);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    await apiMove(bob, reconnectPending, f.working, 1);
    await expect.poll(async () => (await stored(reconnectPending)).valuesJson.summary).toBe("automation ran");
    await network(false);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected", { timeout: 40_000 });
    await expect(lane(alice, f.done).getByTestId(`card-kanban-${reconnectPending}`)).toBeVisible();
    reconnectGate.release();
    expect((await reconnectResponse).status()).toBe(409);
    await reconnectGate.remove();
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${reconnectPending}`)).toBeVisible();
    await expect(card(alice, reconnectPending)).toHaveCount(1);
    await expect(lane(alice, f.done).getByTestId(`card-kanban-${reconnectPending}`)).toHaveCount(0);
    await assertCounts();
    expect(await alice.evaluate(() => performance.timeOrigin)).toBe(originalDocument);

    // Stop only the real SSE transport first, leaving HTTP available for the
    // mutation. No successful write response or invalidation can reach Alice.
    const streamPattern = `**/api/collaboration/pages/${f.page}/stream?*`;
    await alice.route(streamPattern, route => route.abort("internetdisconnected"));
    await alice.evaluate(() =>
      (window as unknown as { disconnectTestStream: () => void }).disconnectTestStream());
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    const lostPattern = `**/api/records/${lostResponse}`;
    let lostWriteAttempts = 0;
    let serverStatus: number | undefined;
    await alice.route(lostPattern, async route => {
      if (route.request().method() !== "PUT") return route.continue();
      lostWriteAttempts += 1;
      // Forward exactly once, obtain the actual committed server response,
      // then discard it and deliver a transport failure to the browser.
      const committedResponse = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      serverStatus = committedResponse.status();
      await network(true);
      await route.abort("connectionfailed");
    });
    const lostRequest = alice.waitForEvent("requestfailed", {
      predicate: request => request.url().endsWith(`/api/records/${lostResponse}`) && request.method() === "PUT",
    });
    await move(alice, lostResponse, "Working");
    expect((await lostRequest).failure()?.errorText).toBeTruthy();
    expect(serverStatus).toBe(200);
    await expect.poll(async () => (await stored(lostResponse)).valuesJson).toMatchObject({
      workflow_mark: "transition ran", summary: "automation ran",
    });
    const committedRecord = await stored(lostResponse);
    expect(committedRecord.statusId).toBe(f.working);
    expect(committedRecord.version).toBeGreaterThan(1);
    // A rollback is only local: Bob sees the real committed move.
    await expect(lane(bob, f.working).getByTestId(`card-kanban-${lostResponse}`)).toBeVisible();
    await expect(lane(alice, f.ready).getByTestId(`card-kanban-${lostResponse}`)).toBeVisible();
    const runsForLostRecord = () => db.select({ id: entityAutomationRunsTable.id, status: entityAutomationRunsTable.status })
      .from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.recordId, lostResponse));
    await expect.poll(runsForLostRecord).toEqual([{ id: expect.any(Number), status: "success" }]);
    const originalRuns = await runsForLostRecord();
    await alice.unroute(streamPattern);
    await network(false);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected", { timeout: 40_000 });
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${lostResponse}`)).toContainText("automation ran");
    await expect(lane(alice, f.ready).getByTestId(`card-kanban-${lostResponse}`)).toHaveCount(0);
    await expect(card(alice, lostResponse)).toHaveCount(1);
    await assertCounts();
    // Cover delayed invalidations and automatic retries after reconnect.
    await alice.waitForTimeout(2_000);
    expect(lostWriteAttempts).toBe(1);
    expect((await stored(lostResponse)).version).toBe(committedRecord.version);
    expect(await runsForLostRecord()).toEqual(originalRuns);
    await expect(card(alice, lostResponse)).toHaveCount(1);
    await assertCounts();
    expect(await alice.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
    await alice.unroute(lostPattern);
    await cdp.detach();
    await test.info().attach("verified-scenarios", {
      body: JSON.stringify({ independentSessions: 2, actualAPI: true, actualSSE: true, staleCAS: 409,
        sseLanes: [...refreshedStatuses], automation: true, archive: true,
        pendingFilterSuccess: true, pendingFilterConflict: true,
        reconnectMissedMoveAndArchive: true, reconnectDuringPendingConflict: true, noDocumentReload: true,
        committedResponseLost: true, lostWriteAttempts, automationNotRepeated: true }),
      contentType: "application/json",
    });
  } finally {
    for (const gate of gates) gate.release();
    await Promise.all(contexts.map(context => context.close()));
    await cleanup();
  }
});

test("revoked page access rejects SSE reconnect, presence and record reads", async ({ browser, page }) => {
  test.setTimeout(90_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    await guard(page);
    await setup(true);
    const f = fixture!;
    const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
    await alice.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      let streamController: AbortController | undefined;
      Object.assign(window, { disconnectTestStream: () => streamController?.abort() });
      window.fetch = (input, init) => {
        if (String(input).includes("/collaboration/") && String(input).includes("/stream?")) {
          streamController = new AbortController();
          return nativeFetch(input, { ...init, signal: init?.signal
            ? AbortSignal.any([init.signal, streamController.signal]) : streamController.signal });
        }
        return nativeFetch(input, init);
      };
    });
    await Promise.all([login(alice, emails[0]), login(bob, emails[1])]);
    const originalDocument = await alice.evaluate(() => performance.timeOrigin);
    const clientId = await alice.evaluate(() => sessionStorage.getItem("erp_client_id"));
    const streamPattern = `**/api/collaboration/pages/${f.page}/stream?*`;
    const keep = f.records[0];
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(1);
    // Isolate SSE loss: taking the entire browser offline also retries metadata
    // on network recovery, which may unmount the board before SSE can retry.
    await alice.route(streamPattern, route => route.abort("internetdisconnected"));
    await alice.evaluate(() =>
      (window as unknown as { disconnectTestStream: () => void }).disconnectTestStream());
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    await db.update(rolesTable).set({ permissionsJson: NO_ACCESS_PERMS }).where(eq(rolesTable.id, f.role));
    // Only Alice loses the page and its records; Bob retains his independent role.
    await apiMove(bob, keep, f.working, 1);
    const reconnectStatuses: number[] = [];
    alice.on("response", response => {
      if (response.url().includes(`/collaboration/pages/${f.page}/stream?`)) reconnectStatuses.push(response.status());
    });
    const deniedStream = alice.waitForResponse(response =>
      response.url().includes(`/collaboration/pages/${f.page}/stream?`) && response.status() === 403,
      { timeout: 40_000 });
    await alice.unroute(streamPattern);
    const denied = await deniedStream;
    expect(denied.headers()["content-type"]).not.toContain("text/event-stream");
    expect(await denied.json()).toMatchObject({ error: expect.any(String) });
    await expect(alice.locator('[data-testid="collab-connection-status"][data-state="connected"]')).toHaveCount(0);
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${keep}`)).toHaveCount(0);
    const deniedToken = await alice.evaluate(() => localStorage.getItem("erp_token"));
    const deniedPresence = await alice.request.put(`/api/collaboration/pages/${f.page}/presence`, {
      headers: { Authorization: `Bearer ${deniedToken}` }, data: { clientId, editing: null },
    });
    expect(deniedPresence.status()).toBe(403);
    const deniedQuery = await alice.request.post(`/api/entities/${f.entity}/records/query`, {
      headers: { Authorization: `Bearer ${deniedToken}` }, data: { pageId: f.page, page: 1, pageSize: 40 },
    });
    expect(deniedQuery.status()).toBe(403);
    await alice.waitForTimeout(2_000);
    // Metadata refetch can replace the board with its Forbidden screen.
    // Both an absent indicator and a disconnected indicator are safe.
    await expect(alice.locator('[data-testid="collab-connection-status"][data-state="connected"]')).toHaveCount(0);
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    expect(reconnectStatuses.length).toBeGreaterThan(0);
    expect(reconnectStatuses.every(status => status === 403)).toBe(true);
    await expect(lane(bob, f.working).getByTestId(`card-kanban-${keep}`)).toBeVisible();
    expect(await alice.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await cleanup();
  }
});