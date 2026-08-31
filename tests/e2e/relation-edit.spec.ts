import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  auditLogTable,
  db,
  pool,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  loginHistoryTable,
  NO_ACCESS_PERMS,
  pagesTable,
  recordLinksTable,
  relationsTable,
  rolesTable,
  systemEventsTable,
  usersTable,
} from "@workspace/db";

const runId = `${process.pid}-${Date.now()}`;
const sourcePath = `/__relation-edit-e2e-${runId}`;
const mirrorPath = `/__relation-edit-mirror-e2e-${runId}`;
const password = `Relation-${runId}!`;
const email = `relation-edit-${runId}@example.test`;
const oldProjectLabel = `Old project ${runId}`;
const newProjectLabel = `New project ${runId}`;

const fixture: {
  pageIds: number[];
  entityIds: number[];
  roleId: number;
  userId: number;
  orderId: number;
  oldProjectId: number;
  newProjectId: number;
} = {
  pageIds: [],
  entityIds: [],
  roleId: 0,
  userId: 0,
  orderId: 0,
  oldProjectId: 0,
  newProjectId: 0,
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Пароль|Password/).fill(password);
  await page.getByRole("button", { name: /Войти|Sign in|Login/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(sourcePath);
}

test.beforeAll(async () => {
  const [sourcePage, projectPage] = await db
    .insert(pagesTable)
    .values([
      {
        nameJson: { en: `Relation orders ${runId}` },
        path: sourcePath,
        isActive: true,
      },
      {
        nameJson: { en: `Relation projects ${runId}` },
        path: `/__relation-projects-e2e-${runId}`,
        isActive: true,
      },
    ])
    .returning({ id: pagesTable.id });
  fixture.pageIds.push(sourcePage!.id, projectPage!.id);

  const [ordersEntity, projectsEntity] = await db
    .insert(entitiesTable)
    .values([
      {
        entityKey: `relation_orders_e2e_${runId}`,
        nameJson: { en: `Relation orders ${runId}` },
        pageId: sourcePage!.id,
      },
      {
        entityKey: `relation_projects_e2e_${runId}`,
        nameJson: { en: `Relation projects ${runId}` },
        pageId: projectPage!.id,
      },
    ])
    .returning({ id: entitiesTable.id });
  fixture.entityIds.push(ordersEntity!.id, projectsEntity!.id);

  const [mirrorPage] = await db
    .insert(pagesTable)
    .values({
      nameJson: { en: `Relation mirror ${runId}` },
      path: mirrorPath,
      mirrorEntityId: ordersEntity!.id,
      mirrorFieldKeysJson: ["order_note", "project"],
      isActive: true,
    })
    .returning({ id: pagesTable.id });
  fixture.pageIds.push(mirrorPage!.id);

  const recordPerm = {
    view: true,
    create: true,
    update: true,
    delete: true,
    scope: "all" as const,
  };
  const [role] = await db
    .insert(rolesTable)
    .values({
      nameJson: { en: `Relation editor ${runId}` },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        pageIds: fixture.pageIds,
        records: {
          [ordersEntity!.id]: recordPerm,
          [projectsEntity!.id]: recordPerm,
        },
      },
    })
    .returning({ id: rolesTable.id });
  fixture.roleId = role!.id;

  const [relation] = await db
    .insert(relationsTable)
    .values({
      sourceEntityId: ordersEntity!.id,
      targetEntityId: projectsEntity!.id,
      relationKey: `order_project_${runId}`,
      relationType: "many_to_one",
      nameJson: { en: "Project" },
      inverseNameJson: { en: "Orders" },
    })
    .returning({ id: relationsTable.id });

  await db.insert(entityFieldsTable).values([
    {
      entityId: ordersEntity!.id,
      fieldKey: "order_note",
      nameJson: { en: "Order note" },
      fieldType: "text",
      sortOrder: 0,
    },
    {
      entityId: ordersEntity!.id,
      fieldKey: "project",
      nameJson: { en: "Project" },
      fieldType: "relation",
      relationConfigJson: {
        relationId: relation!.id,
        relatedFieldKey: "project_name",
      },
      sortOrder: 1,
    },
    {
      entityId: projectsEntity!.id,
      fieldKey: "project_name",
      nameJson: { en: "Project name" },
      fieldType: "text",
      sortOrder: 0,
    },
  ]);

  const [order] = await db
    .insert(entityRecordsTable)
    .values({
      entityId: ordersEntity!.id,
      valuesJson: { order_note: `Order ${runId}` },
    })
    .returning({ id: entityRecordsTable.id });
  fixture.orderId = order!.id;

  const [oldProject, newProject] = await db
    .insert(entityRecordsTable)
    .values([
      {
        entityId: projectsEntity!.id,
        valuesJson: { project_name: oldProjectLabel },
      },
      {
        entityId: projectsEntity!.id,
        valuesJson: { project_name: newProjectLabel },
      },
    ])
    .returning({ id: entityRecordsTable.id });
  fixture.oldProjectId = oldProject!.id;
  fixture.newProjectId = newProject!.id;

  await db.insert(recordLinksTable).values({
    relationId: relation!.id,
    relationType: "many_to_one",
    sourceRecordId: order!.id,
    targetRecordId: oldProject!.id,
  });

  const passwordHash = await bcrypt.hash(password, 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      firstName: "Relation",
      lastName: "Editor",
      roleId: role!.id,
      language: "en",
    })
    .returning({ id: usersTable.id });
  fixture.userId = user!.id;
});

test.afterAll(async () => {
  try {
    if (fixture.entityIds.length > 0) {
      await db
        .delete(systemEventsTable)
        .where(inArray(systemEventsTable.entityId, fixture.entityIds));
      await db
        .delete(auditLogTable)
        .where(inArray(auditLogTable.entityId, fixture.entityIds));

      const [remainingEvents, remainingAudit] = await Promise.all([
        db
          .select({ id: systemEventsTable.id })
          .from(systemEventsTable)
          .where(inArray(systemEventsTable.entityId, fixture.entityIds)),
        db
          .select({ id: auditLogTable.id })
          .from(auditLogTable)
          .where(inArray(auditLogTable.entityId, fixture.entityIds)),
      ]);
      if (remainingEvents.length > 0 || remainingAudit.length > 0) {
        throw new Error("Relation-edit E2E left non-cascading event or audit rows");
      }
    }
    if (fixture.userId > 0) {
      await db.delete(loginHistoryTable).where(eq(loginHistoryTable.userId, fixture.userId));
      await db.delete(usersTable).where(eq(usersTable.id, fixture.userId));
    }
    if (fixture.entityIds.length > 0) {
      await db.delete(entitiesTable).where(inArray(entitiesTable.id, fixture.entityIds));
    }
    if (fixture.pageIds.length > 0) {
      await db.delete(pagesTable).where(inArray(pagesTable.id, fixture.pageIds));
    }
    if (fixture.roleId > 0) {
      await db.delete(rolesTable).where(eq(rolesTable.id, fixture.roleId));
    }
  } finally {
    await pool.end();
  }
});

test("relation change saves with its returned version and stays fresh across pages", async ({
  page,
}) => {
  await login(page);

  const orderCell = page.locator(
    `[data-testid="record-cell"][data-record-id="${fixture.orderId}"][data-field-key="order_note"]`,
  );
  await expect(orderCell).toContainText(`Order ${runId}`);

  await page
    .locator(
      `[data-testid="record-edit-button"][data-record-id="${fixture.orderId}"]`,
    )
    .click();

  const editDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByTestId("record-dialog-save") });
  const relationPicker = editDialog.getByTestId(
    "entity-relation-picker-project",
  );
  await expect(relationPicker).toContainText(oldProjectLabel);
  await relationPicker.click();

  const linkResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(
        `/api/entities/${fixture.entityIds[0]}/related-link`,
      ) &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await page.getByText(newProjectLabel, { exact: true }).click();
  const linkResponse = await linkResponsePromise;
  const linkResult = (await linkResponse.json()) as { version: number };

  const saveButton = editDialog.getByTestId("record-dialog-save");
  await expect(saveButton).toBeEnabled();
  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/records/${fixture.orderId}`) &&
      response.request().method() === "PUT",
  );
  await saveButton.click();
  const saveResponse = await saveResponsePromise;

  expect(saveResponse.status()).toBe(200);
  expect(saveResponse.request().postDataJSON()).toMatchObject({
    expectedVersion: linkResult.version,
  });
  await expect(page.getByText("Record changed concurrently; please retry")).toHaveCount(0);

  const projectCell = page.locator(
    `[data-testid="record-cell"][data-record-id="${fixture.orderId}"][data-field-key="project"]`,
  );
  await expect(projectCell).toContainText(newProjectLabel);

  await page
    .locator(
      `[data-testid="record-edit-button"][data-record-id="${fixture.orderId}"]`,
    )
    .click();
  const reopenedEditDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByTestId("record-dialog-save") });
  await reopenedEditDialog.getByTestId("entity-relation-picker-project").click();
  // Radix renders PopoverContent in a portal, outside the edit-dialog DOM tree.
  await page.getByTestId("entity-relation-quick-create-project").click();
  await expect(page.getByTestId("quick-create-related-dialog")).toBeVisible();
  await page.getByTestId("quick-create-related-cancel").click();
  await expect(page.getByTestId("quick-create-related-dialog")).toHaveCount(0);
  await expect(reopenedEditDialog.getByTestId("record-dialog-save")).toBeEnabled();
  await reopenedEditDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.evaluate(
    ({ destinationPath, staleLabel }) => {
      const state = window as typeof window & {
        __sawStaleRelationAfterNavigation?: boolean;
        __staleRelationObserver?: MutationObserver;
      };
      state.__sawStaleRelationAfterNavigation = false;
      state.__staleRelationObserver?.disconnect();
      state.__staleRelationObserver = new MutationObserver(() => {
        if (
          window.location.pathname === destinationPath &&
          document.body.innerText.includes(staleLabel)
        ) {
          state.__sawStaleRelationAfterNavigation = true;
        }
      });
      state.__staleRelationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    },
    { destinationPath: mirrorPath, staleLabel: oldProjectLabel },
  );

  await page.locator(`a[href="${mirrorPath}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${mirrorPath}$`));
  await expect(
    page.locator(
      `[data-testid="record-cell"][data-record-id="${fixture.orderId}"][data-field-key="project"]`,
    ),
  ).toContainText(newProjectLabel);
  expect(
    await page.evaluate(() => {
      const state = window as typeof window & {
        __sawStaleRelationAfterNavigation?: boolean;
      };
      return state.__sawStaleRelationAfterNavigation;
    }),
  ).toBe(false);
});