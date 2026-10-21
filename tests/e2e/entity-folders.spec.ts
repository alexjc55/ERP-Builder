import { test, expect } from "@playwright/test";

test("entity folders create, assign, collapse, rename and delete without losing entities", async ({ page }) => {
  let folders: { id: number; nameJson: { ru: string } }[] = [];
  let entity = { id: 71, entityKey: "test", nameJson: { ru: "Заказы" }, isActive: true, sortOrder: 0, folderId: null as number | null };
  await page.addInitScript(() => localStorage.setItem("erp_token", "test"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/auth/me")) return route.fulfill({ json: {
      id: 1, roleId: 1, roleIds: [1], firstName: "Test", lastName: "Admin", language: "ru",
      permissions: { superAdmin: true, admin: { entities: true }, records: {}, pageIds: [] },
    } });
    if (path.endsWith("/entity-folders")) {
      if (method === "POST") {
        const folder = { id: 1, ...route.request().postDataJSON() }; folders = [folder];
        return route.fulfill({ status: 201, json: folder });
      }
      return route.fulfill({ json: folders });
    }
    if (path.endsWith("/entity-folders/1")) {
      if (method === "DELETE") { folders = []; entity.folderId = null; return route.fulfill({ status: 204 }); }
      folders[0] = { id: 1, ...route.request().postDataJSON() };
      return route.fulfill({ json: folders[0] });
    }
    if (path.endsWith("/entities/71")) {
      if (method === "PUT") entity = { ...entity, ...route.request().postDataJSON() };
      return route.fulfill({ json: entity });
    }
    if (path.endsWith("/entities")) return route.fulfill({ json: [entity] });
    if (path.endsWith("/settings")) return route.fulfill({ json: { appNameJson: { ru: "ERP" }, defaultLanguage: "ru" } });
    if (path.endsWith("/security/summary")) return route.fulfill({ json: { unreviewedAlerts: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/admin/entities");
  await page.getByRole("button", { name: "Создать папку", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Продажи");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Продажи (0)", exact: true })).toBeVisible();
  await page.goto("/admin/entities?edit=71");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Папка", exact: true }).click();
  await page.getByRole("option", { name: "Продажи", exact: true }).click();
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Продажи (1)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Продажи (1)", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Заказы", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Продажи (1)", exact: true }).click();
  await page.getByRole("button", { name: "Редактировать Продажи", exact: true }).click();
  await dialog.getByRole("textbox").fill("Отдел продаж");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Отдел продаж (1)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Удалить Отдел продаж", exact: true }).click();
  await expect(dialog).toContainText("Удаляется только папка");
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Без папки (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Заказы", exact: true })).toBeVisible();
});
