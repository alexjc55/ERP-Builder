import { expect, test, type Page, type Route } from "@playwright/test";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";
import {
  db, pool, pagesTable, entitiesTable, entityFieldsTable, entityRecordsTable,
  entityStatusesTable, entityTransitionsTable, viewsTable, rolesTable, usersTable,
  NO_ACCESS_PERMS, entityAutomationsTable, entityAutomationRunsTable,
  auditLogTable, systemEventsTable, loginHistoryTable, userRolesTable,
  pageFieldsTable, pageRecordValuesTable,
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
  expect(await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, f.entity))).toHaveLength(0);
  expect(await db.select().from(systemEventsTable).where(eq(systemEventsTable.entityId, f.entity))).toHaveLength(0);
  expect(await db.select().from(loginHistoryTable).where(inArray(loginHistoryTable.userId, f.users))).toHaveLength(0);
  const identity = await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`);
  expect(identity.rows[0].database).toBe("heliumdb");
  expect(identity.rows[0].fingerprint).toBe(process.env.KANBAN_E2E_DEV_FINGERPRINT);
  console.log("Kanban fixture cleanup verified: entity/page/users/roles/records/automations/runs/audit/events/logins all zero; independently approved fingerprint restored");
  // Retain ownership if deletion/verification throws so afterAll can retry
  // cleanup before closing the pool. Never forget an unverified fixture.
  fixture = undefined;
}

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await pool.end();
  }
});

for (const scope of ["own", "filter"] as const) {
  test(`no-status warning respects ${scope} scope, cancel, confirm, empty and failed checks`, async ({ page }) => {
    test.setTimeout(90_000);
    await guard(page);
    await setup(true);
    const f = fixture!;
    try {
      await db.update(rolesTable).set({ permissionsJson: {
        ...NO_ACCESS_PERMS, pageIds: [f.page],
        admin: { ...NO_ACCESS_PERMS.admin, entities: true },
        records: { [f.entity]: { view: true, create: false, update: false, delete: false, scope,
          ...(scope === "filter" ? { scopeFilters: [{ fieldKey: "summary", values: ["visible"] }] } : { scopeFieldKeys: ["owner"] }),
        } },
      } }).where(eq(rolesTable.id, f.role));
      await db.insert(entityFieldsTable).values({ entityId: f.entity, fieldKey: "owner", nameJson: { en: "Owner" }, fieldType: "user" });
      await db.update(entityRecordsTable).set({ valuesJson: { title: "Visible fixture", summary: "visible", owner: f.users[0] } })
        .where(eq(entityRecordsTable.id, f.records[0]));
      await db.update(entityRecordsTable).set({ statusId: null, valuesJson: { title: "SECRET HIDDEN CARD", summary: "hidden", owner: f.users[1] } })
        .where(eq(entityRecordsTable.id, f.records[1]));
      await page.goto("/login");
      await page.getByLabel("Email").fill(emails[0]);
      await page.getByLabel(/Password|Пароль/).fill(password);
      await page.getByRole("button", { name: /Sign in|Login|Войти/ }).click();
      await expect(page).not.toHaveURL(/\/login$/);
      await page.goto(`/admin/entities/${f.entity}/statuses`);
      const toggle = page.locator("#allow-no-status");
      await expect(toggle).toBeChecked();
      const writes: unknown[] = [];
      page.on("request", request => {
        if (request.method() === "PUT" && request.url().endsWith(`/api/entities/${f.entity}`)) writes.push(request.postDataJSON());
      });
      const check = () => page.waitForResponse(r => r.url().endsWith(`/api/entities/${f.entity}/records/query`));
      const snapshot = async () => (await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, f.entity))).sort((a, b) => a.id - b.id);
      const before = await snapshot();
      // Hidden rows exist, but the authorized endpoint must report zero.
      const emptyResponse = check();
      await toggle.click();
      expect(await (await emptyResponse).json()).toMatchObject({ total: 0, data: [] });
      await expect(toggle).not.toBeChecked();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(writes).toEqual([{ allowNoStatus: false }]);
      await toggle.click();
      await expect(toggle).toBeChecked();
      expect(await snapshot()).toEqual(before);
      await db.update(entityRecordsTable).set({ statusId: null }).where(eq(entityRecordsTable.id, f.records[0]));
      const visibleBefore = await snapshot();
      const response = check();
      await toggle.click();
      const body = await (await response).json();
      expect(body.total).toBe(1);
      expect(body.data.map((r: { id: number }) => r.id)).toEqual([f.records[0]]);
      expect(JSON.stringify(body)).not.toContain("SECRET HIDDEN CARD");
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(/останутся в таблице|remain in the table/);
      const count = writes.length;
      await dialog.getByRole("button", { name: /Cancel|Отмена/, exact: true }).click();
      await expect(toggle).toBeChecked();
      expect(writes).toHaveLength(count);
      await toggle.click();
      await dialog.getByRole("button", { name: /Disable|Отключить/, exact: true }).click();
      await expect(toggle).not.toBeChecked();
      expect(writes.at(-1)).toEqual({ allowNoStatus: false });
      expect(await snapshot()).toEqual(visibleBefore);
      await toggle.click();
      await expect(toggle).toBeChecked();
      const beforeFailure = writes.length;
      const pattern = `**/api/entities/${f.entity}/records/query`;
      // Transport fault only; own/filter assertions above use real server responses.
      await page.route(pattern, route => route.abort("failed"));
      await toggle.click();
      await expect(page.getByText(/Не удалось проверить записи|Could not check records/).first()).toBeVisible();
      await expect(toggle).toBeChecked();
      await expect(toggle).toBeEnabled();
      expect(writes).toHaveLength(beforeFailure);
      await page.unroute(pattern);
    } finally {
      await page.goto("about:blank");
      await cleanup();
    }
  });
}

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

test("page status scope enforces queries, individual and bulk moves, and shared handoff", async ({ page }) => {
  await guard(page);
  await setup();
  let mirrorId: number | undefined;
  try {
    const f = fixture!;
    const [mirror] = await db.insert(pagesTable).values({
      path: `${path}-receiving`, nameJson: { en: `${key}-receiving` }, mirrorEntityId: f.entity,
      statusScopeJson: { statusIds: [f.ready, f.working], includeNoStatus: false, allowAllChanges: false },
    }).returning();
    mirrorId = mirror.id;
    await db.update(rolesTable).set({ permissionsJson: {
      ...NO_ACCESS_PERMS, pageIds: [f.page, mirror.id],
      records: { [f.entity]: { view: true, create: true, update: true, delete: false, scope: "all" } },
    } }).where(eq(rolesTable.id, f.role));
    await db.update(pagesTable).set({
      statusScopeJson: { statusIds: [f.ready], includeNoStatus: false, allowAllChanges: false },
    }).where(eq(pagesTable.id, f.page));
    const headers = { Authorization: `Bearer ${signToken({ userId: f.users[0], roleId: f.role })}` };
    const query = async (body: object = {}) => {
      const response = await page.request.post(`/api/entities/${f.entity}/records/query`, {
        headers, data: { showHiddenStatuses: true, pageSize: 100, ...body },
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    expect((await query()).total).toBe(f.records.length);
    expect((await query({ statusIds: [f.working] })).total).toBe(0);
    expect((await query({ statusIsNull: true })).total).toBe(0);
    const before = (await query()).data.find((row: { id: number }) => row.id === f.records[0]);
    const denied = await page.request.put(`/api/records/${before.id}`, {
      headers, data: { statusId: f.working, expectedVersion: before.version },
    });
    expect(denied.status()).toBe(403);
    const bulkDenied = await page.request.post("/api/records/bulk-field", {
      headers, data: { entityId: f.entity, recordIds: [before.id], statusId: f.working,
        expectedVersions: { [before.id]: before.version } },
    });
    expect(bulkDenied.status(), await bulkDenied.text()).toBe(403);
    // The same shared record can be received through a mirror whose selection
    // contains both the handoff status and the destination.
    expect((await query({ pageId: mirror.id })).data.some((row: { id: number }) => row.id === before.id)).toBe(true);
    const received = await page.request.put(`/api/records/${before.id}`, {
      headers, data: { pageId: mirror.id, statusId: f.working, expectedVersion: before.version },
    });
    expect(received.ok(), await received.text()).toBe(true);
    expect((await query()).data.some((row: { id: number }) => row.id === before.id)).toBe(false);
    expect((await query({ pageId: mirror.id, statusIds: [f.working] })).total).toBe(1);
    // Allowing all destinations must not widen the read boundary.
    await db.update(pagesTable).set({
      statusScopeJson: { statusIds: [f.ready], includeNoStatus: false, allowAllChanges: true },
    }).where(eq(pagesTable.id, f.page));
    const next = (await query()).data[0];
    const outside = await page.request.put(`/api/records/${next.id}`, {
      headers, data: { statusId: f.working, expectedVersion: next.version },
    });
    expect(outside.ok(), await outside.text()).toBe(true);
    expect((await query({ statusIds: [f.working] })).total).toBe(0);
    // Empty means no rows, never an accidental all-status fallback.
    await db.update(pagesTable).set({
      statusScopeJson: { statusIds: [], includeNoStatus: false, allowAllChanges: false },
    }).where(eq(pagesTable.id, f.page));
    expect((await query()).total).toBe(0);
  } finally {
    if (mirrorId != null) await db.delete(pagesTable).where(eq(pagesTable.id, mirrorId));
    await cleanup();
  }
});

for (const scope of ["own", "filter", "mixed"] as const) {
  for (const mirrorContext of [false, true]) {
    for (const superAdmin of [false, true]) {
      test(`page status privacy matrix: ${scope}, mirror=${mirrorContext}, super=${superAdmin}`, async ({ page }) => {
        await guard(page);
        await setup(true);
        const f = fixture!;
        let mirrorId: number | undefined;
        try {
          const policy = { statusIds: [f.ready], includeNoStatus: false, allowAllChanges: true };
          await db.update(pagesTable).set({ statusScopeJson: policy }).where(eq(pagesTable.id, f.page));
          if (mirrorContext) {
            const [mirror] = await db.insert(pagesTable).values({
              path: `${path}-privacy`, nameJson: { en: key }, mirrorEntityId: f.entity,
              statusScopeJson: policy,
            }).returning();
            mirrorId = mirror.id;
            // Make accidental main-page policy reuse observable.
            await db.update(pagesTable).set({
              statusScopeJson: { ...policy, statusIds: [f.working] },
            }).where(eq(pagesTable.id, f.page));
          }
          // Main-page context is inferred; the records API reserves pageId for mirrors.
          const pageId = mirrorId;
          await db.insert(entityFieldsTable).values(["owner", "reviewer"].map(fieldKey => ({
            entityId: f.entity, fieldKey, nameJson: { en: fieldKey }, fieldType: "user",
          })));
          // Distinct primary-role, additional-role and unowned records, both inside
          // and outside the page. Union of role scopes must precede page intersection.
          for (let i = 0; i < f.records.length; i++) {
            await db.update(entityRecordsTable).set({
              statusId: i < 3 ? f.ready : i === 5 ? null : f.working,
              valuesJson: {
                title: `private-row-${i}`, summary: i % 3 === 0 ? "primary" : i % 3 === 1 ? "additional" : "neither",
                owner: i % 3 === 0 ? f.users[0] : f.users[1],
                reviewer: i % 3 === 1 ? f.users[0] : f.users[1],
              },
            }).where(eq(entityRecordsTable.id, f.records[i]));
          }
          const all = { view: true, create: false, update: true, delete: false, scope: "all" as const };
          for (const [index, roleId] of [f.role, f.bobRole].entries()) {
            const roleScope = scope === "mixed" ? (index === 0 ? "own" : "filter") : scope;
            const scoped = {
              ...all, scope: roleScope,
              ...(roleScope === "own"
                ? { scopeFieldKeys: [index === 0 ? "owner" : "reviewer"] }
                : { scopeFilters: [{ fieldKey: "summary", values: [index === 0 ? "primary" : "additional"] }] }),
            };
            await db.update(rolesTable).set({ permissionsJson: {
              ...NO_ACCESS_PERMS, superAdmin: superAdmin && index === 1,
              pageIds: [f.page, ...(mirrorId ? [mirrorId] : [])],
              // A mirror override must narrow even an unrestricted entity grant.
              records: mirrorId ? { [f.entity]: all, [`mirror:${mirrorId}`]: scoped } : { [f.entity]: scoped },
            } }).where(eq(rolesTable.id, roleId));
          }
          await db.insert(userRolesTable).values({ userId: f.users[0], roleId: f.bobRole });
          const headers = { Authorization: `Bearer ${signToken({ userId: f.users[0], roleId: f.role })}` };
          const query = async (extra: object = {}) => {
            const response = await page.request.post(`/api/entities/${f.entity}/records/query`, {
              headers, data: { pageId, pageSize: 100, showHiddenStatuses: true, ...extra },
            });
            expect(response.ok(), await response.text()).toBe(true);
            return response.json();
          };
          const allowedIndices = superAdmin ? [0, 1, 2] : [0, 1];
          const expectedIds = allowedIndices.map(i => f.records[i]).sort((a, b) => a - b);
          const result = await query();
          expect(result.total).toBe(expectedIds.length);
          expect(result.data.map((row: { id: number }) => row.id).sort((a: number, b: number) => a - b)).toEqual(expectedIds);
          const firstPage = await query({ pageSize: 1 });
          expect(firstPage.total).toBe(expectedIds.length);
          expect(firstPage.data).toHaveLength(1);
          expect((await query({ statusIds: [f.working] })).total).toBe(0);
          expect((await query({ statusIsNull: true })).total).toBe(0);
          const filter = await page.request.post(`/api/entities/${f.entity}/records/filter-values`, {
            headers, data: { pageId, field: "title", showHiddenStatuses: true },
          });
          expect(filter.ok(), await filter.text()).toBe(true);
          expect((await filter.json()).values.sort()).toEqual(allowedIndices.map(i => `private-row-${i}`));
          const snapshot = async () => ({
            rows: await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, f.entity)).orderBy(entityRecordsTable.id),
            audit: await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, f.entity)),
            events: await db.select().from(systemEventsTable).where(eq(systemEventsTable.entityId, f.entity)),
          });
          const before = await snapshot();
          const blockedIndices = superAdmin ? [3, 4, 5] : [2, 3, 4, 5];
          for (const index of blockedIndices) {
            const blocked = before.rows.find(row => row.id === f.records[index])!;
            const direct = await page.request.put(`/api/records/${blocked.id}`, {
              headers, data: { pageId, expectedVersion: blocked.version, valuesJson: { title: "must-not-write" } },
            });
            expect(direct.status(), await direct.text()).toBe(404);
            const visible = before.rows.find(row => row.id === f.records[0])!;
            const bulk = await page.request.post("/api/records/bulk-field", {
              headers, data: {
                pageId, entityId: f.entity, recordIds: [visible.id, blocked.id],
                fieldKey: "title", value: "must-not-partially-write",
                expectedVersions: { [visible.id]: visible.version, [blocked.id]: blocked.version },
              },
            });
            expect(bulk.status(), await bulk.text()).toBe(404);
          }
          expect(await snapshot()).toEqual(before);
          // Positive control: the additional role genuinely permits a write.
          const extraRoleRecord = before.rows.find(row => row.id === f.records[1])!;
          const allowedWrite = await page.request.put(`/api/records/${extraRoleRecord.id}`, {
            headers, data: {
              pageId, expectedVersion: extraRoleRecord.version,
              valuesJson: { title: "additional-role-authorized" },
            },
          });
          expect(allowedWrite.ok(), await allowedWrite.text()).toBe(true);
          const [saved] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, extraRoleRecord.id));
          expect(saved.valuesJson).toMatchObject({ title: "additional-role-authorized" });
          expect(saved.version).toBe(extraRoleRecord.version + 1);
        } finally {
          if (mirrorId != null) {
            await db.delete(pagesTable).where(eq(pagesTable.id, mirrorId));
            expect(await db.select().from(pagesTable).where(eq(pagesTable.id, mirrorId))).toHaveLength(0);
          }
          await cleanup();
          expect(await db.select().from(userRolesTable).where(inArray(userRolesTable.userId, f.users))).toHaveLength(0);
        }
      });
    }
  }
}

for (const fieldSource of ["entity", "page"] as const) {
  for (const bulk of [false, true]) {
    for (const destinationSelected of [false, true]) {
    test(`mapped page status scope: ${fieldSource}, bulk=${bulk}, selected=${destinationSelected}`, async ({ page }) => {
      await guard(page);
      await setup();
      const f = fixture!;
      let mirrorId: number | undefined;
      try {
        const policy = { statusIds: destinationSelected ? [f.ready, f.working] : [f.ready], includeNoStatus: false, allowAllChanges: false };
        const [mirror] = await db.insert(pagesTable).values({
          path: `${path}-mapped`, nameJson: { en: key }, mirrorEntityId: f.entity, statusScopeJson: policy,
        }).returning();
        mirrorId = mirror.id;
        await db.update(rolesTable).set({ permissionsJson: {
          ...NO_ACCESS_PERMS, pageIds: [f.page, mirror.id],
          records: { [f.entity]: { view: true, create: false, update: true, delete: false, scope: "all" } },
        } }).where(eq(rolesTable.id, f.role));
        const definition = {
          fieldKey: "mapped_stage", nameJson: { en: "Mapped stage" }, fieldType: "select",
          optionsJson: [{ value: "working", labelJson: { en: "Working" }, statusId: f.working }],
        };
        if (fieldSource === "entity") await db.insert(entityFieldsTable).values({ ...definition, entityId: f.entity });
        else await db.insert(pageFieldsTable).values({ ...definition, pageId: mirror.id });
        const recordIds = bulk ? f.records.slice(0, 2) : f.records.slice(0, 1);
        const headers = { Authorization: `Bearer ${signToken({ userId: f.users[0], roleId: f.role })}` };
        const snapshot = async () => ({
          records: await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, f.entity)).orderBy(entityRecordsTable.id),
          values: await db.select().from(pageRecordValuesTable).where(eq(pageRecordValuesTable.pageId, mirror.id)),
          audit: await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, f.entity)),
          events: await db.select().from(systemEventsTable).where(eq(systemEventsTable.entityId, f.entity)),
        });
        const before = await snapshot();
        const versions = Object.fromEntries(before.records.map(row => [row.id, row.version]));
        const write = async () => {
          if (fieldSource === "entity") {
            return bulk
              ? page.request.post("/api/records/bulk-field", { headers, data: {
                pageId: mirror.id, entityId: f.entity, recordIds, fieldKey: definition.fieldKey,
                value: "working", expectedVersions: versions,
              } })
              : page.request.put(`/api/records/${recordIds[0]}`, { headers, data: {
                pageId: mirror.id, valuesJson: { mapped_stage: "working" }, expectedVersion: versions[recordIds[0]],
              } });
          }
          return bulk
            ? page.request.post(`/api/pages/${mirror.id}/records/bulk-field-values`, { headers, data: {
              fieldKey: definition.fieldKey, value: "working", recordIds,
            } })
            : page.request.put(`/api/pages/${mirror.id}/records/${recordIds[0]}/values`, { headers, data: {
              valuesJson: { mapped_stage: "working" }, expectedVersions: { [mirror.id]: 0 },
            } });
        };
        if (!destinationSelected) {
          const denied = await write();
          // The single page-value route classifies locked validation as 400;
          // other write routes classify this policy restriction as 403.
          expect(denied.status(), await denied.text()).toBe(fieldSource === "page" && !bulk ? 400 : 403);
          expect((await denied.json()).error).toContain("This status is not available on this page");
          expect(await snapshot()).toEqual(before);
          await db.update(pagesTable).set({ statusScopeJson: { ...policy, allowAllChanges: true } })
            .where(eq(pagesTable.id, mirror.id));
        }
        const allowed = await write();
        expect(allowed.ok(), await allowed.text()).toBe(true);
        const after = await snapshot();
        for (const id of recordIds) {
          const row = after.records.find(row => row.id === id)!;
          expect(row.statusId).toBe(f.working);
          expect(row.version).toBeGreaterThan(versions[id]);
          expect(row.valuesJson).toMatchObject({ workflow_mark: "transition ran" });
          const values = fieldSource === "entity" ? row.valuesJson : after.values.find(value => value.recordId === id)?.valuesJson;
          expect(values).toMatchObject({ mapped_stage: "working" });
          expect(after.audit.some(entry => entry.recordId === id && entry.fieldKey === "__status__")).toBe(true);
          expect(after.events.some(entry => entry.recordId === id && entry.eventName === "status.changed")).toBe(true);
        }
        for (const row of before.records.filter(row => !recordIds.includes(row.id))) {
          expect(after.records.find(current => current.id === row.id)).toEqual(row);
        }
        const visible = await page.request.post(`/api/entities/${f.entity}/records/query`, {
          headers, data: { pageId: mirror.id, pageSize: 100, showHiddenStatuses: true },
        });
        expect(visible.ok(), await visible.text()).toBe(true);
        const body = await visible.json();
        expect(body.total).toBe(f.records.length - (destinationSelected ? 0 : recordIds.length));
        expect(body.data.some((row: { id: number }) => recordIds.includes(row.id))).toBe(destinationSelected);
      } finally {
        if (mirrorId != null) {
          await db.delete(pagesTable).where(eq(pagesTable.id, mirrorId));
          expect(await db.select().from(pageFieldsTable).where(eq(pageFieldsTable.pageId, mirrorId))).toHaveLength(0);
          expect(await db.select().from(pageRecordValuesTable).where(eq(pageRecordValuesTable.pageId, mirrorId))).toHaveLength(0);
        }
        await cleanup();
      }
    });
    }
  }
}

for (const mode of ["table", "kanban"] as const) {
  for (const automatic of [false, true]) {
  test(`open page status policy refresh: ${mode}, automatic=${automatic}`, async ({ browser, page }) => {
    test.setTimeout(90_000);
    await guard(page);
    await setup(true);
    const f = fixture!;
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    let release = () => {};
    try {
      await db.update(rolesTable).set({ permissionsJson: {
        ...NO_ACCESS_PERMS, superAdmin: true,
      } }).where(eq(rolesTable.id, f.bobRole));
      await db.update(viewsTable).set({ configJson: {
        viewType: mode, ...(mode === "kanban" ? { kanban: { titleField: "title", fields: ["summary"] } } : {}),
      } }).where(eq(viewsTable.entityId, f.entity));
      await db.update(entityRecordsTable).set({ statusId: f.working }).where(eq(entityRecordsTable.id, f.records[1]));
      const [employee, admin] = await Promise.all(contexts.map(c => c.newPage()));
      for (const [index, p] of [employee, admin].entries()) {
        const token = signToken({ userId: f.users[index], roleId: index ? f.bobRole : f.role });
        await p.addInitScript(token => localStorage.setItem("erp_token", token), token);
        await p.goto(path);
      }
      const row = (id: number) => mode === "kanban"
        ? employee.getByTestId(`card-kanban-${id}`)
        : employee.locator(`[data-testid="record-cell"][data-record-id="${id}"][data-field-key="title"]`);
      await expect(row(f.records[1])).toBeVisible();
      await expect(employee.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
      const origin = await employee.evaluate(() => performance.timeOrigin);
      const updatePolicy = async (policy: { statusIds: number[]; includeNoStatus: boolean; allowAllChanges: boolean } | null) => {
        const response = await admin.request.put(`/api/pages/${f.page}`, {
          headers: { Authorization: `Bearer ${signToken({ userId: f.users[1], roleId: f.bobRole })}` },
          data: { statusScopeJson: policy },
        });
        expect(response.ok(), await response.text()).toBe(true);
      };
      const refresh = async () => {
        if (automatic) return;
        await expect(employee.getByTestId("button-refresh-data-desktop")).toBeEnabled();
        await employee.getByTestId("button-refresh-data-desktop").click();
        await expect(employee.getByTestId("button-refresh-data-desktop")).toBeEnabled();
      };
      const checkDestination = async (available: boolean) => {
        if (mode === "kanban") {
          await employee.getByTestId(`button-actions-kanban-${f.records[0]}`).click();
          await expect(employee.getByRole("menuitem", { name: "Working", exact: true })).toHaveCount(available ? 1 : 0);
          await employee.keyboard.press("Escape");
        } else {
          await employee.locator(`[data-testid="record-edit-button"][data-record-id="${f.records[0]}"]`).click();
          await employee.getByRole("dialog").getByRole("combobox").click();
          await expect(employee.getByRole("option", { name: "Working", exact: true })).toHaveCount(available ? 1 : 0);
          await employee.keyboard.press("Escape");
          await employee.keyboard.press("Escape");
        }
      };
      // Hold an already-authorized old response; the server bytes remain real.
      let seen!: () => void;
      const captured = new Promise<void>(resolve => { seen = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; });
      let held = false;
      let delivered!: () => void;
      const oldDelivered = new Promise<void>(resolve => { delivered = resolve; });
      await employee.route(`**/api/entities/${f.entity}/records/query`, async route => {
        if (held || (mode === "kanban" && route.request().postDataJSON().statusIds?.[0] !== f.working)) return route.continue();
        held = true;
        const response = await route.fetch();
        seen();
        await barrier;
        await route.fulfill({ response });
        delivered();
      });
      // Trigger the old read via a real event from the other session, leaving
      // global refresh available while that response is held.
      const changed = await admin.request.put(`/api/records/${f.records[0]}`, {
        headers: { Authorization: `Bearer ${signToken({ userId: f.users[1], roleId: f.bobRole })}` },
        data: { expectedVersion: 1, valuesJson: { title: "Refreshed card" } },
      });
      expect(changed.ok(), await changed.text()).toBe(true);
      await captured;
      const selected = { statusIds: [f.ready], includeNoStatus: false, allowAllChanges: false };
      await updatePolicy(selected);
      await refresh();
      await expect(row(f.records[1])).toHaveCount(0);
      await expect(row(f.records[0])).toBeVisible();
      release();
      await oldDelivered;
      // Let the fulfilled response and React's scheduled work reach the DOM,
      // rather than asserting absence before the old result is processed.
      await employee.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(row(f.records[1])).toHaveCount(0);
      if (mode === "kanban") await expect(employee.getByTestId(`text-lane-count-s:${f.ready}`)).toHaveText("5");
      else await expect(employee.getByText("Shown 1–5 of 5", { exact: true })).toBeVisible();
      await employee.getByRole("button", { name: "Status", exact: true }).click();
      await expect(employee.getByRole("dialog").getByText("Working", { exact: true })).toHaveCount(0);
      await employee.keyboard.press("Escape");
      await checkDestination(false);
      await updatePolicy({ ...selected, allowAllChanges: true });
      await refresh();
      await checkDestination(true);
      await expect(row(f.records[1])).toHaveCount(0);
      await updatePolicy({ ...selected, statusIds: [] });
      await refresh();
      await expect(row(f.records[0])).toHaveCount(0);
      if (mode === "kanban") await expect(employee.locator("[data-kanban-lane]")).toHaveCount(0);
      else await expect(employee.getByText("Shown 1–5 of 5", { exact: true })).toHaveCount(0);
      await updatePolicy(null);
      await refresh();
      await expect(row(f.records[0])).toBeVisible();
      await expect(row(f.records[1])).toBeVisible();
      if (mode === "kanban") {
        await expect(employee.getByTestId(`text-lane-count-s:${f.ready}`)).toHaveText("5");
        await expect(employee.getByTestId(`text-lane-count-s:${f.working}`)).toHaveText("1");
      } else await expect(employee.getByText("Shown 1–6 of 6", { exact: true })).toBeVisible();
      await employee.getByRole("button", { name: "Status", exact: true }).click();
      await expect(employee.getByRole("dialog").getByText("Working", { exact: true })).toBeVisible();
      await employee.keyboard.press("Escape");
      await checkDestination(true);
      expect(await employee.evaluate(() => performance.timeOrigin)).toBe(origin);
    } finally {
      release();
      await Promise.all(contexts.map(c => c.close()));
      await cleanup();
    }
  });
}

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
    // Keep Chromium interception enabled while individual write barriers are
    // removed. Disabling the last route during a post-409 refresh can strand
    // already-paused lane requests. This forwards all native bytes unchanged.
    await alice.route("**/api/**", route => route.continue());
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
      ["Reconnect moved", "Reconnect archived", "Reconnect pending", "Lost response card", "Lost manual archive response"].map(title => ({
        entityId: f.entity, statusId: f.ready, valuesJson: { title, summary: "seed" },
      })),
    ).returning();
    f.records.push(...reconnectRecords.map(record => record.id));
    const [reconnectMoved, reconnectArchived, reconnectPending, lostResponse, lostManualArchive] = reconnectRecords.map(record => record.id);
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

    // #141: manual POST archive, not a status PUT/automatic archive trigger.
    // Keep the stream blocked until the server's successful response is lost.
    await alice.route(streamPattern, route => route.abort("internetdisconnected"));
    await alice.evaluate(() =>
      (window as unknown as { disconnectTestStream: () => void }).disconnectTestStream());
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    const beforeArchive = await stored(lostManualArchive);
    const archivePattern = `**/api/records/${lostManualArchive}/archive`;
    const archiveHistory = async () => ({
      audit: await db.select({ id: auditLogTable.id }).from(auditLogTable)
        .where(and(eq(auditLogTable.recordId, lostManualArchive), eq(auditLogTable.fieldKey, "__archived__"))),
      events: await db.select({ id: systemEventsTable.id }).from(systemEventsTable)
        .where(and(eq(systemEventsTable.entityId, f.entity), eq(systemEventsTable.recordId, lostManualArchive))),
      runs: await db.select({ id: entityAutomationRunsTable.id }).from(entityAutomationRunsTable)
        .where(eq(entityAutomationRunsTable.recordId, lostManualArchive)),
    });
    const beforeArchiveHistory = await archiveHistory();
    let manualArchiveAttempts = 0;
    let manualArchiveServerStatus: number | undefined;
    let manualArchiveRequest: { method: string; body: Record<string, unknown> } | undefined;
    let persistedBeforeResponseLoss: Awaited<ReturnType<typeof stored>> | undefined;
    let manualArchiveTransportError: unknown;
    await alice.route(archivePattern, async route => {
      // Do not throw assertions from an asynchronous route callback: Playwright
      // can start worker teardown before the test's fixture cleanup completes.
      try {
        manualArchiveRequest = { method: route.request().method(), body: route.request().postDataJSON() };
        manualArchiveAttempts += 1;
        const committedResponse = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
        manualArchiveServerStatus = committedResponse.status();
        // Persistence is established BEFORE discarding the HTTP response.
        persistedBeforeResponseLoss = await stored(lostManualArchive);
      } catch (error) {
        manualArchiveTransportError = error;
      } finally {
        await route.abort("connectionfailed");
      }
    });
    const lostArchiveRequest = alice.waitForEvent("requestfailed", {
      predicate: request => request.url().endsWith(`/api/records/${lostManualArchive}/archive`) && request.method() === "POST",
    });
    await alice.getByTestId(`button-actions-kanban-${lostManualArchive}`).click();
    await alice.getByRole("menuitem", { name: /^(Archive|В архив)$/ }).click();
    expect((await lostArchiveRequest).failure()?.errorText).toBeTruthy();
    expect(manualArchiveTransportError).toBeUndefined();
    expect(manualArchiveRequest?.method).toBe("POST");
    expect(manualArchiveRequest?.body).toMatchObject({ expectedVersion: beforeArchive.version });
    // Bound entities legitimately omit pageId; mirror-page writes must supply
    // it. This fixture is bound, so test CAS without imposing mirror semantics.
    expect(manualArchiveServerStatus).toBe(200);
    expect(persistedBeforeResponseLoss).toMatchObject({
      statusId: f.ready, version: beforeArchive.version + 1, archivedAt: expect.any(Date),
    });
    const committedArchive = await stored(lostManualArchive);
    const committedArchiveHistory = await archiveHistory();
    expect(committedArchiveHistory.audit.length).toBe(beforeArchiveHistory.audit.length + 1);
    expect(committedArchiveHistory.events.length).toBe(beforeArchiveHistory.events.length + 1);
    expect(committedArchiveHistory.runs).toEqual(beforeArchiveHistory.runs);
    await expect(card(bob, lostManualArchive)).toHaveCount(0);
    await expect(card(alice, lostManualArchive)).toBeVisible(); // Local failure rollback, not server rollback.
    await alice.unroute(streamPattern);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected", { timeout: 40_000 });
    await expect(card(alice, lostManualArchive)).toHaveCount(0);
    await assertCounts();
    await alice.waitForTimeout(2_000);
    expect(manualArchiveAttempts).toBe(1);
    expect((await stored(lostManualArchive)).version).toBe(committedArchive.version);
    expect((await stored(lostManualArchive)).archivedAt).toEqual(committedArchive.archivedAt);
    expect(await archiveHistory()).toEqual(committedArchiveHistory);
    await expect(card(alice, lostManualArchive)).toHaveCount(0);
    await assertCounts();
    expect(await alice.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
    await alice.unroute(archivePattern);
    await cdp.detach();
    await test.info().attach("verified-scenarios", {
      body: JSON.stringify({ independentSessions: 2, actualAPI: true, actualSSE: true, staleCAS: 409,
        sseLanes: [...refreshedStatuses], automation: true, archive: true,
        pendingFilterSuccess: true, pendingFilterConflict: true,
        reconnectMissedMoveAndArchive: true, reconnectDuringPendingConflict: true, noDocumentReload: true,
        committedResponseLost: true, lostWriteAttempts, automationNotRepeated: true,
        manualPostArchiveResponseLost: true, manualArchiveAttempts, archiveVersionIncrement: 1,
        archiveAuditAndEventExactlyOnce: true }),
      contentType: "application/json",
    });
  } finally {
    for (const gate of gates) gate.release();
    await Promise.all(contexts.map(context => context.close()));
    await cleanup();
  }
});

test("restored access recovers after repeated real 403 streams without reload or duplicate subscriptions", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await guard(page);
  await setup(true);
  const f = fixture!;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
    const statuses: number[] = [];
    let presenceWrites = 0;
    alice.on("response", response => {
      if (response.url().includes("/collaboration/") && response.url().includes("/stream?")) statuses.push(response.status());
    });
    alice.on("request", request => {
      if (request.url().includes("/collaboration/") && request.url().endsWith("/presence")) presenceWrites++;
    });
    await Promise.all([login(alice, emails[0]), login(bob, emails[1])]);
    const originalDocument = await alice.evaluate(() => performance.timeOrigin);
    const originalClient = await alice.evaluate(() => sessionStorage.getItem("erp_client_id"));
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, f.role));
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(1);
    await db.update(rolesTable).set({ permissionsJson: NO_ACCESS_PERMS }).where(eq(rolesTable.id, f.role));
    await apiMove(bob, f.records[0], f.working, 1);
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    await expect.poll(() => statuses.filter(s => s === 403).length, { timeout: 110_000 }).toBeGreaterThanOrEqual(3);
    const writesWhileDenied = presenceWrites;
    await alice.waitForTimeout(1_000);
    expect(presenceWrites).toBe(writesWhileDenied);
    expect(statuses.filter(s => s === 200)).toHaveLength(1);
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    await db.update(rolesTable).set({ permissionsJson: role.permissionsJson }).where(eq(rolesTable.id, f.role));
    await expect.poll(() => statuses.filter(s => s === 200).length, { timeout: 40_000 }).toBe(2);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${f.records[0]}`)).toBeVisible();
    await expect(lane(alice, f.ready).getByTestId(`card-kanban-${f.records[0]}`)).toHaveCount(0);
    for (const status of [f.ready, f.working]) {
      await expect(alice.getByTestId(`text-lane-count-s:${status}`))
        .toHaveText(await bob.getByTestId(`text-lane-count-s:${status}`).innerText());
    }
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(1);
    await expect(bob.getByTestId("collab-avatar")).toHaveCount(1);
    await apiMove(bob, f.records[1], f.working, 1);
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${f.records[1]}`)).toBeVisible();
    // The old recovery timer must not create another subscription after success.
    await alice.waitForTimeout(31_000);
    expect(statuses.filter(s => s === 200)).toHaveLength(2);
    expect(await alice.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
    expect(await alice.evaluate(() => sessionStorage.getItem("erp_client_id"))).toBe(originalClient);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await cleanup();
  }
});

test("revoked page access stops an already-open SSE before subsequent events and presence", async ({ browser, page }) => {
  test.setTimeout(90_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    await guard(page);
    await setup(true);
    const f = fixture!;
    const [alice, bob] = await Promise.all(contexts.map(context => context.newPage()));
    await alice.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      const observation = { bytes: "", streamStarts: 0, presenceRequests: 0 };
      Object.assign(window, { collaborationObservation: observation });
      window.fetch = async (input, init) => {
        if (String(input).includes("/collaboration/") && String(input).endsWith("/presence")) {
          observation.presenceRequests += 1;
        }
        const response = await nativeFetch(input, init);
        if (String(input).includes("/collaboration/") && String(input).includes("/stream?")) {
          observation.streamStarts += 1;
          if (response.body) {
            // Observe the SAME native reader/bytes used by the application.
            // No disconnect hook, offline mode, mocked frames or extra reader.
            const nativeGetReader = response.body.getReader.bind(response.body);
            response.body.getReader = (() => {
              const reader = nativeGetReader();
              const nativeRead = reader.read.bind(reader);
              const decoder = new TextDecoder();
              reader.read = async () => {
                const chunk = await nativeRead();
                if (chunk.value) observation.bytes += decoder.decode(chunk.value, { stream: true });
                return chunk;
              };
              return reader;
            }) as typeof response.body.getReader;
          }
        }
        return response;
      };
    });
    await Promise.all([login(alice, emails[0]), login(bob, emails[1])]);
    const originalDocument = await alice.evaluate(() => performance.timeOrigin);
    const clientId = await alice.evaluate(() => sessionStorage.getItem("erp_client_id"));
    const keep = f.records[0];
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(1);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
    const observation = () => alice.evaluate(() =>
      (window as unknown as { collaborationObservation: { bytes: string; streamStarts: number; presenceRequests: number } }).collaborationObservation);
    const beforeRevocation = await observation();
    expect(beforeRevocation.bytes).toContain("event:snapshot");
    expect(beforeRevocation.streamStarts).toBe(1);
    const bobToken = await bob.evaluate(() => localStorage.getItem("erp_token"));
    const bobClient = await bob.evaluate(() => sessionStorage.getItem("erp_client_id"));
    // Revoke while Alice is still consuming the original authorized stream.
    await db.update(rolesTable).set({ permissionsJson: NO_ACCESS_PERMS }).where(eq(rolesTable.id, f.role));
    // Make presence the first post-revocation outbound event. It must be gated
    // just like a mutation invalidation, not sent using the opening profile.
    const bobPresence = await bob.request.put(`/api/collaboration/pages/${f.page}/presence`, {
      headers: { Authorization: `Bearer ${bobToken}` },
      data: { clientId: bobClient, editing: { entityId: f.entity, recordId: keep, fieldKey: "title", source: "entity" } },
    });
    expect(bobPresence.status()).toBe(204);
    await expect.poll(async () => (await observation()).bytes.slice(beforeRevocation.bytes.length))
      .toContain("event:access_denied");
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    await expect(alice.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "disconnected");
    // Bob keeps his independent role, transport and write capability.
    await apiMove(bob, keep, f.working, 1);
    const deniedToken = await alice.evaluate(() => localStorage.getItem("erp_token"));
    const denied = await alice.request.get(`/api/collaboration/pages/${f.page}/stream?clientId=denied-probe-${run}`, {
      headers: { Authorization: `Bearer ${deniedToken}` },
    });
    expect(denied.status()).toBe(403);
    expect(denied.headers()["content-type"]).not.toContain("text/event-stream");
    expect(await denied.json()).toMatchObject({ error: expect.any(String) });
    await expect(alice.locator('[data-testid="collab-connection-status"][data-state="connected"]')).toHaveCount(0);
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    await expect(lane(alice, f.working).getByTestId(`card-kanban-${keep}`)).toHaveCount(0);
    const deniedPresence = await alice.request.put(`/api/collaboration/pages/${f.page}/presence`, {
      headers: { Authorization: `Bearer ${deniedToken}` }, data: { clientId, editing: null },
    });
    expect(deniedPresence.status()).toBe(403);
    const deniedQuery = await alice.request.post(`/api/entities/${f.entity}/records/query`, {
      headers: { Authorization: `Bearer ${deniedToken}` }, data: { pageId: f.page, page: 1, pageSize: 40 },
    });
    expect(deniedQuery.status()).toBe(403);
    const afterDenial = await observation();
    // Includes a full heartbeat interval: denied clients must not keep PUTs or
    // SSE retries alive with stale edit coordinates.
    await alice.waitForTimeout(16_000);
    // Metadata refetch can replace the board with its Forbidden screen.
    // Both an absent indicator and a disconnected indicator are safe.
    await expect(alice.locator('[data-testid="collab-connection-status"][data-state="connected"]')).toHaveCount(0);
    await expect(alice.getByTestId("collab-avatar")).toHaveCount(0);
    const finalObservation = await observation();
    expect(finalObservation.streamStarts).toBe(beforeRevocation.streamStarts);
    expect(finalObservation.presenceRequests).toBe(afterDenial.presenceRequests);
    const postRevocationBytes = finalObservation.bytes.slice(beforeRevocation.bytes.length);
    expect(postRevocationBytes).not.toMatch(/event:(presence|snapshot|table_changed|record_changed|page_changed|delete)/);
    expect(postRevocationBytes).not.toContain('"recordId"');
    expect(postRevocationBytes).not.toContain('"name":"Bob');
    await expect(lane(bob, f.working).getByTestId(`card-kanban-${keep}`)).toBeVisible();
    await expect(bob.getByTestId("collab-connection-status")).toHaveAttribute("data-state", "connected");
    await expect(bob.getByTestId("collab-avatar")).toHaveCount(0);
    expect(await alice.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await cleanup();
  }
});