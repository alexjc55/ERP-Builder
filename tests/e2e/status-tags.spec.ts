import { strict as assert } from "node:assert";
import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  dashboardWidgetsTable,
  db,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  entityStatusesTable,
  loginHistoryTable,
  NO_ACCESS_PERMS,
  pagesTable,
  pool,
  rolesTable,
  statusTagsTable,
  tagsTable,
  usersTable,
} from "@workspace/db";

/**
 * This suite is deliberately opt-in. It creates administrator-authored pages,
 * records, roles, users, widgets, and global tags, so it must never be run
 * against a production database.
 *
 * Run only against the normal development stack with:
 *   RUN_STATUS_TAGS_E2E=1 playwright test tests/e2e/status-tags.spec.ts
 */
const enabled =
  process.env.RUN_STATUS_TAGS_E2E === "1" &&
  process.env.NODE_ENV !== "production" &&
  process.env.REPLIT_ENVIRONMENT !== "production";

const runId = `${process.pid}-${Date.now()}`;
const dashboardPath = `/__status-tags-dashboard-e2e-${runId}`;
const dashboardName = `Status tags dashboard ${runId}`;
const entityKey = `status_tags_e2e_${runId}`;
const entityName = `Status tags records ${runId}`;
const statusOneName = `Status one ${runId}`;
const statusTwoName = `Status two ${runId}`;
const roleName = `Status tags restricted role ${runId}`;
const email = `status-tags-${runId}@example.test`;
const restrictedEmail = `status-tags-restricted-${runId}@example.test`;
const password = `Status-tags-${runId}!`;
const widgetTitle = `Tag metrics ${runId}`;

const fixture = {
  pageId: 0,
  entityId: 0,
  statusIds: [] as number[],
  roleIds: [] as number[],
  userId: 0,
  restrictedUserId: 0,
  tagIds: [] as number[],
  widgetId: 0,
};

let tagOneName = `Status tag A ${runId}`;
const tagTwoName = `Status tag B ${runId}`;

test.skip(
  !enabled,
  "Set RUN_STATUS_TAGS_E2E=1 only for the isolated development database",
);

async function login(page: Page, loginEmail = email) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(loginEmail);
  await page.getByLabel(/Пароль|Password/).fill(password);
  await page.getByRole("button", { name: /Войти|Sign in|Login/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function createTag(
  page: Page,
  name: string,
  color: string,
  sortOrder: number,
) {
  await page
    .getByRole("button", { name: /Добавить тег|Add tag|New tag/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "RU", exact: true }).click();
  await dialog
    .getByPlaceholder(/Русский\)$/)
    .fill(name);
  await dialog.locator('input[placeholder="#RRGGBB"]').fill(color);
  await dialog.locator('input[type="number"]').fill(String(sortOrder));

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tags") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await dialog.getByRole("button", { name: /Создать|Create/ }).click();
  const response = await responsePromise;
  const created = (await response.json()) as { id: number };
  fixture.tagIds.push(created.id);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return created.id;
}

async function editStatusTags(
  page: Page,
  statusName: string,
  tagNames: string[],
) {
  const row = page.locator("tbody tr").filter({ hasText: statusName });
  await expect(row).toHaveCount(1);
  // Status rows render move-up, move-down, edit, and delete in that order.
  await row.getByRole("button").nth(2).click();
  const dialog = page.getByRole("dialog");
  for (const tagName of tagNames) {
    await dialog.getByRole("button", { name: tagName, exact: true }).click();
  }
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().match(/\/api\/statuses\/\d+$/) != null &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await dialog.getByRole("button", { name: /Сохранить|Save/ }).click();
  await responsePromise;
}

async function chooseOpenTag(page: Page, name: string) {
  // StatusTagMultiSelect renders its options in a Radix portal. The option
  // itself is a label containing a checkbox, unlike the tag trigger buttons.
  const option = page.locator("label").filter({ hasText: name }).last();
  await expect(option).toBeVisible();
  await option.click();
}

async function cleanupFixture() {
  const cleanupErrors: unknown[] = [];
  try {
    try {
      const usersByEmail = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.email, [email, restrictedEmail]));
      const userIds = [
        fixture.userId,
        fixture.restrictedUserId,
        ...usersByEmail.map((user) => user.id),
      ].filter((id) => id > 0);
      if (userIds.length > 0) {
        await db
          .delete(loginHistoryTable)
          .where(inArray(loginHistoryTable.userId, userIds));
        await db.delete(usersTable).where(inArray(usersTable.id, userIds));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }

    try {
      if (fixture.widgetId > 0) {
        await db
          .delete(dashboardWidgetsTable)
          .where(eq(dashboardWidgetsTable.id, fixture.widgetId));
      }
      if (fixture.entityId > 0) {
        await db
          .delete(statusTagsTable)
          .where(
            inArray(
              statusTagsTable.statusId,
              fixture.statusIds.length > 0 ? fixture.statusIds : [-1],
            ),
          );
        await db
          .delete(entityRecordsTable)
          .where(eq(entityRecordsTable.entityId, fixture.entityId));
        await db
          .delete(entityStatusesTable)
          .where(eq(entityStatusesTable.entityId, fixture.entityId));
        await db
          .delete(entityFieldsTable)
          .where(eq(entityFieldsTable.entityId, fixture.entityId));
        await db.delete(entitiesTable).where(eq(entitiesTable.id, fixture.entityId));
      }
      if (fixture.pageId > 0) {
        await db.delete(pagesTable).where(eq(pagesTable.id, fixture.pageId));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }

    try {
      // Include names, paths, and e-mail as a recovery path if a mutation
      // succeeded before Playwright lost the response that carried its id.
      const existingTags = await db
        .select({ id: tagsTable.id, nameJson: tagsTable.nameJson })
        .from(tagsTable);
      const recoveredTagIds = existingTags
        .filter((tag) => JSON.stringify(tag.nameJson).includes(runId))
        .map((tag) => tag.id);
      const tagIds = [...new Set([...fixture.tagIds, ...recoveredTagIds])];
      if (tagIds.length > 0) {
        await db.delete(statusTagsTable).where(inArray(statusTagsTable.tagId, tagIds));
        await db.delete(tagsTable).where(inArray(tagsTable.id, tagIds));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }

    try {
      const rolesByRun = await db
        .select({ id: rolesTable.id, nameJson: rolesTable.nameJson })
        .from(rolesTable);
      const recoveredRoleIds = rolesByRun
        .filter((role) => JSON.stringify(role.nameJson).includes(runId))
        .map((role) => role.id);
      const roleIds = [...new Set([...fixture.roleIds, ...recoveredRoleIds])];
      if (roleIds.length > 0) {
        await db
          .delete(rolesTable)
          .where(inArray(rolesTable.id, roleIds));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }

    try {
      // Verify exact fixture identities, including anything whose id was not
      // captured after a partially completed setup or mutation.
      const verificationUserIds = [
        fixture.userId,
        fixture.restrictedUserId,
      ].filter((id) => id > 0);
      const [
        pages,
        entities,
        users,
        roles,
        tags,
        widgets,
        loginHistory,
        statusLinks,
        records,
        statuses,
        fields,
      ] = await Promise.all([
        db
          .select({ id: pagesTable.id })
          .from(pagesTable)
          .where(eq(pagesTable.path, dashboardPath)),
        db
          .select({ id: entitiesTable.id })
          .from(entitiesTable)
          .where(eq(entitiesTable.entityKey, entityKey)),
        db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(inArray(usersTable.email, [email, restrictedEmail])),
        fixture.roleIds.length > 0
          ? db
              .select({ id: rolesTable.id })
              .from(rolesTable)
              .where(inArray(rolesTable.id, fixture.roleIds))
          : Promise.resolve([]),
        db
          .select({ id: tagsTable.id, nameJson: tagsTable.nameJson })
          .from(tagsTable),
        fixture.pageId > 0
          ? db
              .select({ id: dashboardWidgetsTable.id })
              .from(dashboardWidgetsTable)
              .where(eq(dashboardWidgetsTable.pageId, fixture.pageId))
          : Promise.resolve([]),
        verificationUserIds.length > 0
          ? db
              .select({ id: loginHistoryTable.id })
              .from(loginHistoryTable)
              .where(inArray(loginHistoryTable.userId, verificationUserIds))
          : Promise.resolve([]),
        fixture.statusIds.length > 0
          ? db
              .select({ id: statusTagsTable.statusId })
              .from(statusTagsTable)
              .where(inArray(statusTagsTable.statusId, fixture.statusIds))
          : Promise.resolve([]),
        fixture.entityId > 0
          ? db
              .select({ id: entityRecordsTable.id })
              .from(entityRecordsTable)
              .where(eq(entityRecordsTable.entityId, fixture.entityId))
          : Promise.resolve([]),
        fixture.entityId > 0
          ? db
              .select({ id: entityStatusesTable.id })
              .from(entityStatusesTable)
              .where(eq(entityStatusesTable.entityId, fixture.entityId))
          : Promise.resolve([]),
        fixture.entityId > 0
          ? db
              .select({ id: entityFieldsTable.id })
              .from(entityFieldsTable)
              .where(eq(entityFieldsTable.entityId, fixture.entityId))
          : Promise.resolve([]),
      ]);
      const leftoverTags = tags.filter((tag) =>
        JSON.stringify(tag.nameJson).includes(runId),
      );
      const remainingRoles = await db
        .select({ id: rolesTable.id, nameJson: rolesTable.nameJson })
        .from(rolesTable);
      const leftoverRoles = remainingRoles.filter((role) =>
        JSON.stringify(role.nameJson).includes(runId),
      );
      if (
        pages.length > 0 ||
        entities.length > 0 ||
        users.length > 0 ||
        roles.length > 0 ||
        leftoverRoles.length > 0 ||
        leftoverTags.length > 0 ||
        widgets.length > 0 ||
        loginHistory.length > 0 ||
        statusLinks.length > 0 ||
        records.length > 0 ||
        statuses.length > 0 ||
        fields.length > 0
      ) {
        throw new Error(
          `Status-tags E2E cleanup left rows: pages=${pages.length}, entities=${entities.length}, users=${users.length}, roles=${Math.max(roles.length, leftoverRoles.length)}, tags=${leftoverTags.length}, widgets=${widgets.length}, loginHistory=${loginHistory.length}, statusLinks=${statusLinks.length}, records=${records.length}, statuses=${statuses.length}, fields=${fields.length}`,
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  } finally {
    await pool.end();
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Failed to fully clean the status-tags E2E fixture",
    );
  }
}

test.beforeAll(async () => {
  if (!enabled) return;
  if (
    process.env.NODE_ENV === "production" ||
    process.env.REPLIT_ENVIRONMENT === "production"
  ) {
    throw new Error("Refusing to create the status-tags E2E fixture in production");
  }

  const [page] = await db
    .insert(pagesTable)
    .values({
      nameJson: { ru: dashboardName, en: dashboardName },
      path: dashboardPath,
      isDashboard: true,
      isActive: true,
    })
    .returning({ id: pagesTable.id });
  fixture.pageId = page!.id;

  const [entity] = await db
    .insert(entitiesTable)
    .values({
      entityKey,
      nameJson: { ru: entityName, en: entityName },
      isActive: true,
    })
    .returning({ id: entitiesTable.id });
  fixture.entityId = entity!.id;

  await db.insert(entityFieldsTable).values({
    entityId: fixture.entityId,
    fieldKey: "amount",
    nameJson: { ru: "Сумма", en: "Amount" },
    fieldType: "number",
    sortOrder: 0,
  });

  const statuses = await db
    .insert(entityStatusesTable)
    .values([
      {
        entityId: fixture.entityId,
        statusKey: "status_one",
        nameJson: { ru: statusOneName, en: statusOneName },
        color: "#2563eb",
        isDefault: true,
        sortOrder: 0,
      },
      {
        entityId: fixture.entityId,
        statusKey: "status_two",
        nameJson: { ru: statusTwoName, en: statusTwoName },
        color: "#16a34a",
        sortOrder: 1,
      },
    ])
    .returning({ id: entityStatusesTable.id });
  fixture.statusIds = statuses.map((status) => status.id);

  await db.insert(entityRecordsTable).values([
    {
      entityId: fixture.entityId,
      statusId: fixture.statusIds[0],
      valuesJson: { amount: 10 },
    },
    {
      entityId: fixture.entityId,
      statusId: fixture.statusIds[0],
      valuesJson: { amount: 5 },
    },
    {
      entityId: fixture.entityId,
      statusId: fixture.statusIds[1],
      valuesJson: { amount: 20 },
    },
  ]);

  const fullAdminRole = await db
    .insert(rolesTable)
    .values({
      nameJson: { ru: `Status-tags E2E administrator ${runId}` },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        superAdmin: true,
        admin: Object.fromEntries(
          Object.keys(NO_ACCESS_PERMS.admin).map((key) => [key, true]),
        ),
      } as typeof NO_ACCESS_PERMS,
    })
    .returning({ id: rolesTable.id });
  const restrictedRole = await db
    .insert(rolesTable)
    .values({
      nameJson: { ru: roleName, en: roleName },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        pageIds: [fixture.pageId],
        records: {
          [String(fixture.entityId)]: {
            view: true,
            create: false,
            update: false,
            delete: false,
            scope: "all",
          },
        },
      },
    })
    .returning({ id: rolesTable.id });
  fixture.roleIds = [fullAdminRole[0]!.id, restrictedRole[0]!.id];

  const passwordHash = await bcrypt.hash(password, 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      firstName: "Status-tags",
      lastName: "E2E",
      roleId: fixture.roleIds[0]!,
      language: "ru",
    })
    .returning({ id: usersTable.id });
  fixture.userId = user!.id;
  const [restrictedUser] = await db
    .insert(usersTable)
    .values({
      email: restrictedEmail,
      passwordHash,
      firstName: "Status-tags",
      lastName: "Restricted E2E",
      roleId: fixture.roleIds[1]!,
      language: "ru",
    })
    .returning({ id: usersTable.id });
  fixture.restrictedUserId = restrictedUser!.id;
});

test.afterAll(async () => {
  await cleanupFixture();
});

test(
  "covers tag administration, status assignment, role restrictions, and dashboard metrics",
  async ({ page, browser }) => {
  await login(page);

  // Global tag create, edit (including color), and order controls.
  await page.goto("/admin/tags");
  const tagOneId = await createTag(page, tagOneName, "#dc2626", 0);
  await createTag(page, tagTwoName, "#2563eb", 1);
  assert.ok(tagOneId > 0);

  let rows = page.locator("tbody tr");
  await expect(rows.nth(0)).toContainText(tagOneName);
  await expect(rows.nth(1)).toContainText(tagTwoName);

  await rows
    .filter({ hasText: tagOneName })
    .getByRole("button", { name: /Переместить вниз|Move down/ })
    .click();
  await expect(page.locator("tbody tr").nth(0)).toContainText(tagTwoName);

  const editedTagName = `${tagOneName} edited`;
  const editedTagRow = page.locator("tbody tr").filter({ hasText: tagOneName });
  await editedTagRow
    .getByRole("button", { name: /Изменить|Edit/ })
    .click();
  const tagDialog = page.getByRole("dialog");
  await tagDialog.getByRole("tab", { name: "RU", exact: true }).click();
  await tagDialog
    .getByPlaceholder(/Русский\)$/)
    .fill(editedTagName);
  await tagDialog.locator('input[placeholder="#RRGGBB"]').fill("#16a34a");
  await tagDialog.locator('input[type="number"]').fill("0");
  await tagDialog.getByRole("button", { name: /Сохранить|Save/ }).click();
  await expect(page.getByText(editedTagName, { exact: true })).toBeVisible();
  tagOneName = editedTagName;

  rows = page.locator("tbody tr");
  await expect(rows.nth(0)).toContainText(tagOneName);
  await expect(rows.nth(1)).toContainText(tagTwoName);
  await expect(
    rows.nth(0).locator("td").filter({ hasText: "#16a34a" }),
  ).toHaveCount(1);

  // Assign tags to two statuses. The second edit adds and then removes a
  // second tag so the status editor's many-tag selection and clear behavior
  // are exercised without changing the fixture's final metric partition.
  await page.goto(`/admin/entities/${fixture.entityId}/statuses`);
  await editStatusTags(page, statusOneName, [tagOneName]);
  await editStatusTags(page, statusTwoName, [tagTwoName]);
  const statusOneRow = page.locator("tbody tr").filter({ hasText: statusOneName });
  await statusOneRow.getByRole("button").nth(2).click();
  let statusDialog = page.getByRole("dialog");
  await statusDialog.getByRole("button", { name: tagTwoName, exact: true }).click();
  await statusDialog.getByRole("button", { name: /Сохранить|Save/ }).click();
  await expect(page.getByText(tagTwoName, { exact: true })).toBeVisible();
  await statusOneRow.getByRole("button").nth(2).click();
  statusDialog = page.getByRole("dialog");
  await expect(
    statusDialog.getByRole("button", { name: tagTwoName, exact: true }),
  ).toHaveClass(/bg-slate-700/);
  await statusDialog.getByRole("button", { name: tagTwoName, exact: true }).click();
  await statusDialog.getByRole("button", { name: /Сохранить|Save/ }).click();

  await page.getByRole("button", { name: tagOneName, exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(statusOneName);
  await page.getByRole("button", { name: /Все|All/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  // Role editor: grant the tags capability and persist both tag-based status
  // restrictions. The first picker is cleared and then re-selected to cover
  // the reusable picker path rather than only the row-level status buttons.
  await page.goto("/admin/roles");
  const roleHeading = page.getByRole("heading", { name: roleName, exact: true });
  await expect(roleHeading).toBeVisible();
  await roleHeading
    .locator("xpath=../../..")
    .getByRole("button")
    .first()
    .click();
  let roleDialog = page.getByRole("dialog");
  const tagsCapability = roleDialog
    .locator("label")
    .filter({ hasText: /Глобальные теги|Global tags/ })
    .first();
  await expect(tagsCapability).toBeVisible();
  const tagsCapabilityCheckbox = tagsCapability.getByRole("checkbox");
  await tagsCapabilityCheckbox.click();
  await expect(tagsCapabilityCheckbox).toHaveAttribute("aria-checked", "true");

  await roleDialog.getByRole("combobox").last().click();
  await page.getByRole("option", { name: entityName, exact: true }).click();
  await roleDialog
    .getByRole("button", { name: /Добавить права на статусы|Add status rights/ })
    .click();

  let tagPickers = roleDialog.getByRole("button", {
    name: /Все (?:теги видимы|строки видимы)|(?:All tags visible|All rows visible)/,
  });
  await expect(tagPickers).toHaveCount(2);
  await tagPickers.nth(0).click();
  await chooseOpenTag(page, tagOneName);
  await chooseOpenTag(page, tagTwoName);
  await page.getByRole("button", { name: /Очистить|Clear/ }).click();
  await expect(
    roleDialog
      .getByRole("button", {
        name: /Все (?:теги видимы|строки видимы)|(?:All tags visible|All rows visible)/,
      })
      .nth(0),
  ).toBeVisible();
  await roleDialog
    .getByRole("button", {
      name: /Все (?:теги видимы|строки видимы)|(?:All tags visible|All rows visible)/,
    })
    .nth(0)
    .click();
  await chooseOpenTag(page, tagOneName);
  await chooseOpenTag(page, tagTwoName);

  // Once the first picker has selected tags, only the second picker still has
  // the "all tags visible" accessible name.
  await roleDialog
    .getByRole("button", {
      name: /Все (?:теги видимы|строки видимы)|(?:All tags visible|All rows visible)/,
    })
    .first()
    .click();
  await chooseOpenTag(page, tagTwoName);

  const roleUpdatePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/roles/${fixture.roleIds[1]}`) &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await roleDialog.getByRole("button", { name: /Сохранить|Save/ }).click();
  const roleUpdate = await roleUpdatePromise;
  const roleBody = roleUpdate.request().postDataJSON() as {
    permissionsJson: {
      admin: { tags?: boolean };
      records: Record<
        string,
        { hiddenStatusTagIds?: number[]; hiddenRowStatusTagIds?: number[] }
      >;
    };
  };
  expect(roleBody.permissionsJson.admin.tags).toBe(true);
  expect(roleBody.permissionsJson.records[String(fixture.entityId)]).toMatchObject({
    hiddenStatusTagIds: expect.arrayContaining(fixture.tagIds),
    hiddenRowStatusTagIds: expect.arrayContaining([fixture.tagIds[1]]),
  });

  await roleHeading
    .locator("xpath=../../..")
    .getByRole("button")
    .first()
    .click();
  roleDialog = page.getByRole("dialog");
  tagPickers = roleDialog.getByRole("button", {
    name: new RegExp(`${tagOneName}.*${tagTwoName}|${tagTwoName}.*${tagOneName}`),
  });
  await expect(tagPickers).toHaveCount(1);
  await expect(
    roleDialog.getByRole("button", { name: tagTwoName, exact: true }),
  ).toHaveCount(1);
  await roleDialog.getByRole("button", { name: /Отмена|Cancel/ }).click();

  // Exercise the two persisted restrictions as a non-admin viewer: statuses
  // covered by the first tag are absent from the status picker/filter, while
  // rows covered by the second tag are removed from the result set.
  const restrictedContext = await browser.newContext();
  try {
    const restrictedPage = await restrictedContext.newPage();
    await login(restrictedPage, restrictedEmail);
    await restrictedPage.goto("/admin/tags");
    await expect(
      restrictedPage.getByRole("heading", {
        name: /Глобальные теги|Global tags/,
      }),
    ).toBeVisible();
    await restrictedPage.goto(`/admin/entities/${fixture.entityId}/records`);
    await expect(
      restrictedPage.getByText(statusOneName, { exact: true }),
    ).toBeVisible();
    await expect(
      restrictedPage.getByText(statusTwoName, { exact: true }),
    ).toHaveCount(0);
    await expect(
      restrictedPage.getByRole("button", { name: /Статус|Status/, exact: true }),
    ).toHaveCount(0);
  } finally {
    await restrictedContext.close();
  }

  // Seed one dashboard widget after tag ids and status assignments are known.
  // The browser still performs the read and edit round-trip below; direct
  // seeding keeps this test focused on status-tag behavior instead of repeating
  // the much larger dashboard builder fixture.
  const [widget] = await db
    .insert(dashboardWidgetsTable)
    .values({
      pageId: fixture.pageId,
      titleJson: { ru: widgetTitle, en: widgetTitle },
      configJson: {
        widgetType: "metric",
        colorStyle: "icon",
        textColor: "light",
        format: "number",
        metrics: [
          {
            key: "taggedCount",
            entityId: fixture.entityId,
            aggregation: "count",
            fieldKey: null,
            statusIds: null,
            statusTagIds: [fixture.tagIds[0]],
          },
          {
            key: "taggedSum",
            entityId: fixture.entityId,
            aggregation: "sum",
            fieldKey: "amount",
            statusIds: null,
            statusTagIds: [fixture.tagIds[0]],
          },
        ],
      },
      sortOrder: 0,
      gridW: 1,
      gridH: 1,
    })
    .returning({ id: dashboardWidgetsTable.id });
  fixture.widgetId = widget!.id;

  // Dashboard computation must apply a tag filter to both count and sum.
  const dashboardDataPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/pages/${fixture.pageId}/dashboard/data`) &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await page.goto(dashboardPath);
  const dashboardResponse = await dashboardDataPromise;
  const dashboardData = (await dashboardResponse.json()) as Array<{
    id: number;
    titleJson: unknown;
    metrics?: Record<string, number>;
  }>;
  const dashboardWidget = dashboardData.find((item) => item.id === fixture.widgetId);
  expect(dashboardWidget?.metrics).toMatchObject({
    taggedCount: 2,
    taggedSum: 15,
  });
  await expect(page.getByText(widgetTitle, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Настроить|Configure/ }).click();
  await page.getByTitle(/Редактировать виджет|Edit widget/).click();
  const widgetDialog = page.getByRole("dialog");
  const widgetTagTriggers = widgetDialog.getByRole("button", {
    name: tagOneName,
    exact: true,
  });
  await expect(widgetTagTriggers).toHaveCount(2);

  // Clear the first metric's tag filter, confirm the empty state, then add it
  // back before saving so the final aggregation remains deterministic.
  await widgetTagTriggers.nth(0).click();
  await page.getByRole("button", { name: /Очистить|Clear/ }).click();
  await expect(
    widgetDialog.getByRole("button", { name: /Не выбрано|None selected/ }).first(),
  ).toBeVisible();
  await widgetDialog
    .getByRole("button", { name: /Не выбрано|None selected/ })
    .first()
    .click();
  await chooseOpenTag(page, tagOneName);

  const widgetUpdatePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/dashboard/widgets/${fixture.widgetId}`) &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await widgetDialog.getByRole("button", { name: /Сохранить|Save/ }).click();
  const widgetUpdate = await widgetUpdatePromise;
  const widgetBody = widgetUpdate.request().postDataJSON() as {
    config: {
      metrics: Array<{ key: string; statusTagIds?: number[] | null }>;
    };
  };
  expect(widgetBody.config.metrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "taggedCount", statusTagIds: [fixture.tagIds[0]] }),
      expect.objectContaining({ key: "taggedSum", statusTagIds: [fixture.tagIds[0]] }),
    ]),
  );

  await page.getByTitle(/Редактировать виджет|Edit widget/).click();
  const reopenedWidgetDialog = page.getByRole("dialog");
  await expect(
    reopenedWidgetDialog.getByRole("button", { name: tagOneName, exact: true }),
  ).toHaveCount(2);
  await reopenedWidgetDialog.getByRole("button", { name: /Отмена|Cancel/ }).click();

  // Confirm that cleanup can remove references before deleting global tags.
  // This is intentionally a DB assertion, not production data, and catches a
  // test regression that would otherwise leave orphaned tags/pages behind.
  const links = await db
    .select()
    .from(statusTagsTable)
    .where(inArray(statusTagsTable.tagId, fixture.tagIds));
    expect(links.length).toBeGreaterThan(0);
  },
);