import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  auditLogTable,
  db,
  entitiesTable,
  entityAutomationsTable,
  entityFieldsTable,
  loginHistoryTable,
  NO_ACCESS_PERMS,
  pool,
  rolesTable,
  systemEventsTable,
  usersTable,
} from "@workspace/db";

const runId = `${process.pid}-${Date.now()}`;
const password = `Automation-${runId}!`;
const email = `automation-folders-${runId}@example.test`;
const automationName = `Seed automation ${runId}`;
const folderName = `Folder ${runId}`;
const folderNameRu = `Папка ${runId}`;

const fixture: { entityId: number; roleId: number; userId: number; automationId: number } = {
  entityId: 0,
  roleId: 0,
  userId: 0,
  automationId: 0,
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Пароль|Password/).fill(password);
  await page.getByRole("button", { name: /Войти|Sign in|Login/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(`/admin/entities/${fixture.entityId}/automations`);
}

test.beforeAll(async () => {
  const [entity] = await db
    .insert(entitiesTable)
    .values({
      entityKey: `automation_folders_e2e_${runId}`,
      nameJson: { en: `Automation folders ${runId}` },
    })
    .returning({ id: entitiesTable.id });
  fixture.entityId = entity!.id;

  await db.insert(entityFieldsTable).values({
    entityId: fixture.entityId,
    fieldKey: "note",
    nameJson: { en: "Note" },
    fieldType: "text",
    sortOrder: 0,
  });

  const [role] = await db
    .insert(rolesTable)
    .values({
      nameJson: { en: `Automation administrator ${runId}` },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        admin: { ...NO_ACCESS_PERMS.admin, automations: true },
      },
    })
    .returning({ id: rolesTable.id });
  fixture.roleId = role!.id;

  const [automation] = await db
    .insert(entityAutomationsTable)
    .values({
      entityId: fixture.entityId,
      nameJson: { en: automationName },
      isActive: true,
      triggerJson: { type: "record_created" },
      conditionsJson: [],
      conditionConjunction: "and",
      actionsJson: [{ type: "set_field", fieldKey: "note", value: "seed" }],
      sortOrder: 0,
    })
    .returning({ id: entityAutomationsTable.id });
  fixture.automationId = automation!.id;

  const passwordHash = await bcrypt.hash(password, 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      firstName: "Automation",
      lastName: "Administrator",
      roleId: fixture.roleId,
      language: "en",
    })
    .returning({ id: usersTable.id });
  fixture.userId = user!.id;
});

test.afterAll(async () => {
  try {
    if (fixture.entityId > 0) {
      await db.delete(systemEventsTable).where(eq(systemEventsTable.entityId, fixture.entityId));
      await db.delete(auditLogTable).where(eq(auditLogTable.entityId, fixture.entityId));
    }
    if (fixture.userId > 0) {
      await db.delete(loginHistoryTable).where(eq(loginHistoryTable.userId, fixture.userId));
      await db.delete(usersTable).where(eq(usersTable.id, fixture.userId));
    }
    if (fixture.entityId > 0) {
      await db.delete(entitiesTable).where(eq(entitiesTable.id, fixture.entityId));
    }
    if (fixture.roleId > 0) {
      await db.delete(rolesTable).where(eq(rolesTable.id, fixture.roleId));
    }
  } finally {
    await pool.end();
  }
});

test.use({ viewport: { width: 1440, height: 900 } });

test("desktop refresh refetches automation data and folders remain grouped through deletion", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("automation-row").filter({ hasText: automationName })).toBeVisible();

  const initialUrl = page.url();
  const automationsRefresh = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().includes(`/api/entities/${fixture.entityId}/automations`) &&
    !response.url().includes("automation-runs") &&
    response.status() === 200,
  );
  const foldersRefresh = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().includes(`/api/entities/${fixture.entityId}/automation-folders`) &&
    response.status() === 200,
  );
  await page.getByTestId("button-refresh-data-desktop").click();
  await Promise.all([automationsRefresh, foldersRefresh]);
  expect(page.url()).toBe(initialUrl);

  const createFolderResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().includes(`/api/entities/${fixture.entityId}/automation-folders`) &&
    response.status() === 201,
  );
  await page.getByRole("button", { name: /Create folder|Создать папку/ }).click();
  const folderDialog = page.getByRole("dialog").filter({ hasText: /Create folder|Создать папку/ });
  await folderDialog.getByRole("tab", { name: "EN", exact: true }).click();
  await folderDialog.getByPlaceholder(/English\)$/).fill(folderName);
  await folderDialog.getByRole("tab", { name: "RU", exact: true }).click();
  await folderDialog.getByPlaceholder(/Русский\)$/).fill(folderNameRu);
  await folderDialog.getByRole("button", { name: /Save|Сохранить/ }).click();
  const folder = (await (await createFolderResponse).json()) as { id: number };

  const automationRow = page
    .getByTestId("automation-row")
    .filter({ hasText: automationName });
  await automationRow.getByTestId("automation-edit").click();
  const automationDialog = page.getByRole("dialog").filter({ hasText: /Edit automation|Редактировать автоматизацию/ });
  await automationDialog.getByTestId("automation-folder-select").click();
  await page.getByRole("option", { name: folderName, exact: true }).click();
  const assignmentResponse = page.waitForResponse((response) =>
    response.request().method() === "PUT" &&
    response.url().endsWith(`/api/automations/${fixture.automationId}`) &&
    response.status() === 200,
  );
  await automationDialog.getByRole("button", { name: /Save|Сохранить/ }).click();
  await assignmentResponse;

  const folderSection = page.locator(
    `[data-testid="automation-folder-section"][data-folder-id="${folder.id}"]`,
  );
  await expect(folderSection).toContainText(folderName);
  await expect(folderSection).toContainText("(1)");
  await expect(folderSection.getByTestId("automation-row")).toContainText(automationName);

  const deleteFolderResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    response.url().endsWith(`/api/automation-folders/${folder.id}`) &&
    response.status() === 200,
  );
  await folderSection.getByTestId("automation-folder-delete").click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete|Удалить/ }).click();
  await deleteFolderResponse;
  await expect(page.locator(`[data-folder-id="${folder.id}"]`)).toHaveCount(0);
  const ungroupedSection = page.getByTestId("automation-ungrouped-section");
  await expect(ungroupedSection).toContainText("(1)");
  await expect(ungroupedSection.getByTestId("automation-row")).toContainText(automationName);
});