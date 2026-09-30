import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable,
  pagesTable, relationsTable, recordLinksTable, rolesTable, usersTable, NO_ACCESS_PERMS,
  auditLogTable, systemEventsTable, loginHistoryTable, entityAutomationsTable,
  entityAutomationRunsTable,
} from "@workspace/db";

// Supply a fresh fingerprint obtained independently through the platform's
// executeSql(environment:"development"), never computed by this test itself.
// SQL: SELECT md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) FROM entities;
// The running API must additionally expose the same metadata before fixtures.
const run = randomUUID();
const path = `/__delivery-e2e-${run}`;
const ids: number[] = [], pages: number[] = [];
let user = 0, role = 0;
const email = `delivery-${run}@example.test`, password = `Delivery-${run}!`;
let base = 0, member = 0, parent = 0, baseParent = 0, memberParent = 0, selection = 0;
let orders: number[] = [], items: number[] = [], ready = 0, done = 0, automation = 0;

async function guard(page: Page) {
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.hostname, "Only the known local Replit development database is permitted").toBe("helium");
  expect(url.pathname).toBe("/heliumdb");
  const fingerprint = process.env.DELIVERY_E2E_DEV_FINGERPRINT;
  expect(fingerprint, "Provide independent executeSql development fingerprint").toMatch(/^[a-f0-9]{32}$/);
  const result = await db.execute(sql`SELECT md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) AS fingerprint FROM entities`);
  expect(result.rows[0]?.fingerprint).toBe(fingerprint);
  expect(test.info().project.use.baseURL).toBe("http://localhost:80");
  const [admin] = await db.select({ id: usersTable.id, roleId: usersTable.roleId }).from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
    .where(and(eq(usersTable.isActive, true), sql`${rolesTable.permissionsJson}->>'superAdmin' = 'true'`)).limit(1);
  expect(admin, "An existing local administrator is required for read-only API target verification").toBeTruthy();
  // Read-only target probe. Never log the ephemeral token or mutate this user.
  const probe = await page.request.get("/api/entities", { headers: { Authorization: `Bearer ${signToken({ userId: admin.id, roleId: admin.roleId })}` } });
  expect(probe.ok()).toBe(true);
  const key = (e: { id: number; entityKey: string }) => `${e.id}:${e.entityKey}`;
  expect((await probe.json()).map(key).sort()).toEqual((await db.select().from(entitiesTable)).map(key).sort());
}

async function api(page: Page, route: string, method = "GET", data?: unknown) {
  const token = await page.evaluate(() => localStorage.getItem("erp_token"));
  return page.request.fetch(`/api${route}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
}
async function links(record: number) {
  return (await db.select().from(recordLinksTable).where(and(eq(recordLinksTable.sourceRecordId, record), eq(recordLinksTable.relationId, selection))))
    .map(r => r.targetRecordId).sort((a, b) => a - b);
}

test("Delivery browser → real API → selected-only status automation", async ({ page }) => {
  test.setTimeout(180_000);
  await guard(page);
  page.setDefaultTimeout(15_000);
  try {
    // Commit setup as one transaction: a partial fixture cannot escape cleanup.
    await db.transaction(async tx => {
      const ps = await tx.insert(pagesTable).values(["Delivery", "Items", "Orders"].map((name, i) => ({
        nameJson: { en: `${name} ${run}` }, path: i ? `${path}-${i}` : path,
      }))).returning();
      pages.push(...ps.map(p => p.id));
      const es = await tx.insert(entitiesTable).values(ps.map((p, i) => ({
        entityKey: `delivery_e2e_${run}_${i}`, nameJson: p.nameJson, pageId: p.id,
      }))).returning();
      ids.push(...es.map(e => e.id)); [base, member, parent] = ids;
      const rs = await tx.insert(relationsTable).values([
        { sourceEntityId: base, targetEntityId: parent, relationKey: "order", relationType: "many_to_one", nameJson: { en: "Order" } },
        { sourceEntityId: member, targetEntityId: parent, relationKey: "order", relationType: "many_to_one", nameJson: { en: "Order" } },
        { sourceEntityId: base, targetEntityId: member, relationKey: "members", relationType: "many_to_many", nameJson: { en: "Members" } },
      ]).returning();
      [baseParent, memberParent, selection] = rs.map(r => r.id);
      await tx.insert(entityFieldsTable).values([
        ...ids.map(entityId => ({ entityId, fieldKey: "name", nameJson: { en: "Name" }, sortOrder: 0 })),
        ...[base, member].map((entityId, i) => ({ entityId, fieldKey: "order", nameJson: { en: "Order" }, sortOrder: 1, fieldType: "relation", relationConfigJson: { relationId: i ? memberParent : baseParent, relatedFieldKey: "name" } })),
        { entityId: base, fieldKey: "members", nameJson: { en: "Members" }, sortOrder: 2, fieldType: "relation", relationConfigJson: { relationId: selection, relatedFieldKey: "name", selectionMode: "single" } },
      ]);
      orders = (await tx.insert(entityRecordsTable).values(["Order A", "Order B"].map(name => ({ entityId: parent, valuesJson: { name } }))).returning()).map(r => r.id);
      items = (await tx.insert(entityRecordsTable).values(Array.from({ length: 62 }, (_, i) => ({ entityId: member, valuesJson: { name: `Item ${String(i).padStart(2, "0")}` } }))).returning()).map(r => r.id);
      await tx.insert(recordLinksTable).values(items.map((id, i) => ({ relationId: memberParent, relationType: "many_to_one", sourceRecordId: id, targetRecordId: orders[i === 61 ? 1 : 0] })));
      [ready, done] = (await tx.insert(entityStatusesTable).values([
        { entityId: base, statusKey: "ready", nameJson: { en: "Ready" } },
        { entityId: member, statusKey: "done", nameJson: { en: "Done" } },
      ]).returning()).map(s => s.id);
      const [rule] = await tx.insert(entityAutomationsTable).values({ entityId: base,
        triggerJson: { type: "status_changed", toStatusId: ready },
        actionsJson: [{ type: "set_related_status", relationId: selection, statusId: done }],
      }).returning();
      automation = rule.id;
      const [r] = await tx.insert(rolesTable).values({ nameJson: { en: run }, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true } }).returning();
      role = r.id;
      const [u] = await tx.insert(usersTable).values({ email, passwordHash: await bcrypt.hash(password, 4), firstName: "Delivery", lastName: "Test", roleId: role, language: "en" }).returning();
      user = u.id;
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel(/Password|Пароль/).fill(password);
    await page.getByRole("button", { name: /Sign in|Login|Войти/ }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    const apiEntities = await (await api(page, "/entities")).json();
    expect(apiEntities.map((e: { id: number }) => e.id).sort((a: number, b: number) => a - b))
      .toEqual((await db.select().from(entitiesTable)).map(e => e.id).sort((a, b) => a - b));

    // Configure the dependency through the actual field editor.
    await page.goto(`/admin/entities/${base}/fields`);
    await page.getByRole("row").filter({ hasText: "members" }).getByRole("button").nth(2).click();
    const fieldDialog = page.getByRole("dialog");
    const choose = async (label: string, option: string) => {
      await fieldDialog.locator("label").filter({ hasText: new RegExp(label, "i") }).locator("..").getByRole("combobox").click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await choose("Выбор связанных записей", "Несколько записей");
    await fieldDialog.getByRole("switch", { name: "Показывать статус и тег в списке" }).check();
    await fieldDialog.getByRole("switch", { name: "Разрешить создание связанной записи" }).uncheck();
    await choose("Depend|Зависит", "Order");
    await choose("Filter.*field|Поле фильтрации", "Order");
    await fieldDialog.getByRole("button", { name: /^(Save|Сохранить)$/ }).click();
    await expect(fieldDialog).toHaveCount(0);
    await page.reload();
    await page.getByRole("row").filter({ hasText: "members" }).getByRole("button").nth(2).click();
    await expect(fieldDialog.getByRole("switch", { name: "Показывать статус и тег в списке" })).toBeChecked();
    await expect(fieldDialog.getByRole("switch", { name: "Разрешить создание связанной записи" })).not.toBeChecked();
    await page.goto(path);
    await page.getByRole("button", { name: /^(Add record|Добавить запись)$/ }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByTestId("record-dialog-save") });
    await dialog.getByText(/^(Select a record|Выберите запись)$/).click();
    await page.getByText("Order A", { exact: true }).click();
    const candidateResponse = page.waitForResponse(r => r.url().includes("related-candidates") && r.request().postDataJSON()?.fieldKey === "members");
    await dialog.getByRole("button", { name: "0", exact: true }).click();
    const candidateResult = await candidateResponse;
    expect(candidateResult.request().postDataJSON()).toMatchObject({ all: true, parentValue: String(orders[0]) });
    // The picker opens with a full permission-filtered snapshot.
    await page.getByRole("button", { name: "Выбрать все (61)" }).click();
    await page.getByRole("button", { name: "Сохранить выбор" }).click();
    const create = page.waitForResponse(r => r.url().endsWith(`/entities/${base}/records`) && r.request().method() === "POST");
    await dialog.getByTestId("record-dialog-save").click();
    const response = await create;
    expect(response.status()).toBe(201);
    const record = await response.json();
    expect(response.request().postDataJSON().relationSelections.map((s: { fieldKey: string }) => s.fieldKey)).toEqual(["order", "members"]);
    expect(response.request().postDataJSON().relationSelections).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "order", linkedRecordIds: [orders[0]] }),
      expect.objectContaining({ fieldKey: "members", linkedRecordIds: expect.arrayContaining(items.slice(0, 61)) }),
    ]));
    await expect.poll(() => links(record.id)).toEqual(items.slice(0, 61));
    await page.reload();
    const cell = page.locator(`[data-testid="record-cell"][data-record-id="${record.id}"][data-field-key="members"]`);
    await cell.getByRole("button", { name: "61", exact: true }).click();
    await page.getByRole("button", { name: /Очистить/ }).click();
    await page.getByText("Item 00", { exact: true }).click();
    await page.getByText("Item 01", { exact: true }).click();
    await page.getByRole("button", { name: "Сохранить выбор" }).click();
    await expect.poll(() => links(record.id)).toEqual(items.slice(0, 2));
    await page.reload();
    await expect(cell.getByRole("button", { name: "2", exact: true })).toBeVisible();
    await page.locator(`[data-testid="record-edit-button"][data-record-id="${record.id}"]`).click();
    await dialog.getByRole("combobox").last().click();
    await page.getByRole("option", { name: "Ready", exact: true }).click();
    await dialog.getByTestId("record-dialog-save").click();
    await expect.poll(async () => (await db.select().from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.automationId, automation))).map(r => r.status)).toContain("success");
    const statuses = await db.select().from(entityRecordsTable).where(inArray(entityRecordsTable.id, items));
    expect(statuses.filter(r => r.statusId === done).map(r => r.id).sort((a, b) => a - b)).toEqual(items.slice(0, 2));
    // Force a late-row integrity failure on fixture-only data. The first two
    // targets must roll back, including their version, audit and events.
    await db.update(entityRecordsTable).set({ statusId: null }).where(inArray(entityRecordsTable.id, items.slice(0, 2)));
    const [bad] = await db.insert(entityRecordsTable).values({ entityId: parent }).returning();
    const [badLink] = await db.insert(recordLinksTable).values({ relationId: selection, relationType: "many_to_many", sourceRecordId: record.id, targetRecordId: bad.id }).returning();
    const snapshot = async () => ({
      records: await db.select().from(entityRecordsTable).where(inArray(entityRecordsTable.id, items.slice(0, 2))).orderBy(entityRecordsTable.id),
      audit: await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, member)).orderBy(auditLogTable.id),
      events: await db.select().from(systemEventsTable).where(eq(systemEventsTable.entityId, member)).orderBy(systemEventsTable.id),
    });
    const before = await snapshot();
    for (const statusId of [null, ready]) {
      const current = await (await api(page, `/records/${record.id}`)).json();
      expect((await api(page, `/records/${record.id}`, "PUT", { statusId, expectedVersion: current.version })).ok()).toBe(true);
    }
    await expect.poll(async () => (await db.select().from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.automationId, automation))).map(r => r.status)).toContain("error");
    expect(await snapshot()).toEqual(before);
    await db.delete(recordLinksTable).where(eq(recordLinksTable.id, badLink.id));
    await page.reload();
    await page.locator(`[data-testid="record-edit-button"][data-record-id="${record.id}"]`).click();
    await dialog.getByTestId("entity-relation-picker-order").click();
    let warned = false;
    page.once("dialog", async warning => { warned = true; await warning.accept(); });
    await page.getByText("Order B", { exact: true }).click();
    await expect.poll(() => links(record.id)).toEqual([]);
    expect(warned).toBe(true);
    await dialog.getByTestId("record-dialog-save").click();
    await page.reload();
    await expect(cell.getByRole("button", { name: "0", exact: true })).toBeVisible();
    const countBefore = (await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, base))).length;
    const invalid = await api(page, `/entities/${base}/records`, "POST", { valuesJson: {}, relationSelections: [
      { fieldKey: "members", linkedRecordIds: [items[61]] }, { fieldKey: "order", linkedRecordIds: [orders[0]] },
    ] });
    expect(invalid.status()).toBe(400);
    expect(await invalid.text()).toContain("не соответствует родителю");
    expect((await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, base))).length).toBe(countBefore);
  } finally {
    // Separate teardown budget from the browser action/test deadline.
    test.setTimeout(test.info().timeout + 30_000);
    await cleanup();
  }
});

async function cleanup() {
    if (ids.length) {
      await db.delete(entityAutomationsTable).where(inArray(entityAutomationsTable.entityId, ids));
      await db.delete(auditLogTable).where(inArray(auditLogTable.entityId, ids));
      await db.delete(systemEventsTable).where(inArray(systemEventsTable.entityId, ids));
      await db.delete(entitiesTable).where(inArray(entitiesTable.id, ids));
    }
    if (user) { await db.delete(loginHistoryTable).where(eq(loginHistoryTable.userId, user)); await db.delete(usersTable).where(eq(usersTable.id, user)); }
    if (pages.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pages));
    if (role) await db.delete(rolesTable).where(eq(rolesTable.id, role));
    if (pages.length) expect(await db.select().from(pagesTable).where(inArray(pagesTable.id, pages))).toEqual([]);
    if (user) {
      expect(await db.select().from(usersTable).where(eq(usersTable.id, user))).toEqual([]);
      expect(await db.select().from(loginHistoryTable).where(eq(loginHistoryTable.userId, user))).toEqual([]);
    }
    if (role) expect(await db.select().from(rolesTable).where(eq(rolesTable.id, role))).toEqual([]);
    if (ids.length) {
      expect(await db.select().from(entitiesTable).where(inArray(entitiesTable.id, ids))).toEqual([]);
      expect(await db.select().from(auditLogTable).where(inArray(auditLogTable.entityId, ids))).toEqual([]);
      expect(await db.select().from(systemEventsTable).where(inArray(systemEventsTable.entityId, ids))).toEqual([]);
      expect(await db.select().from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.automationId, automation))).toEqual([]);
    }
}

test.afterAll(async () => {
  // Independent hook budget also retries cleanup if the test itself timed out.
  test.setTimeout(30_000);
  try { await cleanup(); } finally { await pool.end(); }
});