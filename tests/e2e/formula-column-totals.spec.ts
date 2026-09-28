import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, pagesTable,
  pageFieldsTable, pageRecordValuesTable, rolesTable, usersTable, NO_ACCESS_PERMS,
} from "@workspace/db";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";

// Requires the current API build plus Vite, and creates only disposable fixtures.
test.skip(process.env.RUN_FORMULA_TOTALS_E2E !== "1" ||
  process.env.NODE_ENV === "production" || process.env.REPLIT_ENVIRONMENT === "production",
  "Opt in only on the development stack with RUN_FORMULA_TOTALS_E2E=1");

test("entity and page editors persist modes; table displays 110%, 55%, 19% after reload", async ({ page }) => {
  const key = `formula_e2e_${randomUUID().replaceAll("-", "")}`;
  let entityId = 0, pageId = 0, roleId = 0, userId = 0;
  try {
    [entityId] = (await db.insert(entitiesTable).values({ entityKey: key, nameJson: { ru: key } }).returning()).map(r => r.id);
    [pageId] = (await db.insert(pagesTable).values({
      nameJson: { ru: key }, path: `/${key}`, mirrorEntityId: entityId,
    }).returning()).map(r => r.id);
    [roleId] = (await db.insert(rolesTable).values({
      nameJson: { ru: key }, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true },
    }).returning()).map(r => r.id);
    [userId] = (await db.insert(usersTable).values({
      email: `${key}@example.invalid`, firstName: "Formula", lastName: "E2E", roleId, language: "ru",
    }).returning()).map(r => r.id);
    const expression = "{produced}/{planned}*100";
    const fields = await db.insert(entityFieldsTable).values([
      ...["produced", "planned"].map((fieldKey, sortOrder) => ({
        entityId, fieldKey, nameJson: { ru: fieldKey }, fieldType: "number" as const, sortOrder,
      })),
      { entityId, fieldKey: "production", nameJson: { ru: "E2E производство" }, fieldType: "function", sortOrder: 2,
        showColumnTotal: true, formulaConfigJson: { expression, totalMode: "sum", displayAffix: "%" } },
    ]).returning();
    const [local] = await db.insert(pageFieldsTable).values({
      pageId, fieldKey: "page_production", nameJson: { ru: "E2E страница" }, fieldType: "function",
      showColumnTotal: true, formulaConfigJson: { expression, totalMode: "sum", displayAffix: "%" },
    }).returning();
    await db.insert(entityRecordsTable).values([
      { entityId, valuesJson: { planned: 100, produced: 100 } },
      { entityId, valuesJson: { planned: 900, produced: 90 } },
    ]);
    const token = signToken({ userId, roleId });
    await page.addInitScript(token => localStorage.setItem("erp_token", token), token);
    const changeMode = async (title: string, mode: string, endpoint: RegExp) => {
      await page.getByRole("button", { name: "Режим настройки", exact: true }).click();
      await page.getByRole("button", { name: new RegExp(title) }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Как считать итог", { exact: true }).click();
      await page.getByRole("option", { name: mode, exact: true }).click();
      const saved = page.waitForResponse(r => endpoint.test(r.url()) && r.request().method() === "PUT" && r.status() === 200);
      await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
      await saved;
      await expect(dialog).not.toBeVisible();
      await page.reload();
    };
    await page.goto(`/admin/entities/${entityId}/records`);
    await expect(page.getByText("110%", { exact: true })).toBeVisible();
    const entityField = fields.find(f => f.fieldKey === "production")!;
    await changeMode("E2E производство", "Среднее результатов строк", new RegExp(`/api/fields/${entityField.id}$`));
    await expect(page.getByText("55%", { exact: true })).toBeVisible();
    await changeMode("E2E производство", "Формула по итогам колонок", new RegExp(`/api/fields/${entityField.id}$`));
    await expect(page.getByText("19%", { exact: true })).toBeVisible();
    await page.goto(`/${key}`);
    await expect(page.getByText("110%", { exact: true })).toBeVisible();
    await changeMode("E2E страница", "Формула по итогам колонок", new RegExp(`/api/page-fields/${local.id}$`));
    await expect(page.getByText("19%", { exact: true }).first()).toBeVisible();
    const [savedEntity] = await db.select().from(entityFieldsTable).where(eq(entityFieldsTable.id, entityField.id));
    const [savedPage] = await db.select().from(pageFieldsTable).where(eq(pageFieldsTable.id, local.id));
    expect(savedEntity.formulaConfigJson.totalMode).toBe("formula");
    expect(savedPage.formulaConfigJson.totalMode).toBe("formula");
  } finally {
    if (pageId) {
      await db.delete(pageRecordValuesTable).where(eq(pageRecordValuesTable.pageId, pageId));
      await db.delete(pagesTable).where(eq(pagesTable.id, pageId));
    }
    if (entityId) await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (roleId) await db.delete(rolesTable).where(eq(rolesTable.id, roleId));
  }
});

test.afterAll(async () => { await pool.end(); });