import { test, expect } from "@playwright/test";

async function setup(page: import("@playwright/test").Page, options: { previewError?: boolean; conflict?: boolean; retained?: boolean } = {}) {
  const writes: { folderAction: string; revision: string }[] = [];
  let configured = !options.retained;
  let forgotten = false;
  await page.addInitScript(() => localStorage.setItem("erp_token", "ui-test-only"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: {
      id: 1, roleId: 1, roleIds: [1], firstName: "Test", lastName: "Admin", language: "ru",
      permissions: { superAdmin: true, admin: {}, records: {}, pageIds: [] },
    } });
    const conn = { keyMode: "own", connected: configured, configured, folderConfigured: !forgotten,
      hasOwnCreds: true, builtinAvailable: false, ownClientId: "test-client", redirectUri: "https://example.invalid/callback",
      accountEmail: "test@example.invalid", folderId: forgotten ? undefined : "root", folderName: forgotten ? undefined : "Root",
      health: { state: configured ? "healthy" : "unknown" } };
    if (path.endsWith("/google-drive/disconnect-preview")) return route.fulfill({
      status: options.previewError ? 500 : 200,
      json: options.previewError ? { error: "Preview failed" } : {
        revision: writes.length ? "new-revision" : "revision-1",
        folders: [{ folderId: "root", name: "Root", fields: 2, entities: 1, pages: 1, records: 3 }],
      },
    });
    if (path.endsWith("/google-drive/disconnect")) {
      const data = route.request().postDataJSON(); writes.push(data);
      if (options.conflict) return route.fulfill({ status: 409, json: { error: "Changed" } });
      configured = false; forgotten = data.folderAction === "forget";
      return route.fulfill({ json: { ...conn, connected: false, configured: false, folderConfigured: !forgotten } });
    }
    if (path.endsWith("/google-drive/connection")) return route.fulfill({ json: conn });
    if (path.endsWith("/google-drive/folders")) return route.fulfill({ json: forgotten ? [] : [
      { id: 1, driveFolderId: "root", name: "Root", isDefault: true, parentId: null, nameTemplateJson: null },
    ] });
    if (path.endsWith("/settings") || path.endsWith("/settings/public")) return route.fulfill({ json: { appNameJson: { ru: "ERP" }, defaultLanguage: "ru" } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/admin/google-drive");
  await page.getByRole("button", { name: options.retained ? "Сохранённые папки: сохранить или удалить" : "Отключить", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return writes;
}

test("keep is default, shows usage, sends explicit snapshot and preserves retained controls", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[value="keep"]')).toBeChecked();
  await expect(dialog.getByRole("row").filter({ hasText: "Root" })).toContainText("3");
  await dialog.getByRole("button", { name: "Отключить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toEqual([{ folderAction: "keep", revision: "revision-1" }]);
  await expect(page.getByRole("button", { name: "Сохранённые папки: сохранить или удалить", exact: true })).toBeVisible();
});

test("forget on a retained connection requires additional consent and is usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await setup(page, { retained: true });
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[value="forget"]').check();
  await expect(dialog.getByRole("button", { name: "Отключить", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Отключить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toEqual([{ folderAction: "forget", revision: "revision-1" }]);
});

test("preview failure prevents any disconnect and cancel has no side effects", async ({ page }) => {
  const writes = await setup(page, { previewError: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Отключить", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(writes).toEqual([]);
});

test("conflict leaves dialog open, refreshes the preview and requires new destructive consent", async ({ page }) => {
  const writes = await setup(page, { conflict: true });
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[value="forget"]').check();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Отключить", exact: true }).click();
  await expect(page.getByText("Отключение не выполнено. Проверьте обновлённые данные и повторите.", { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  expect(writes).toHaveLength(1);
});
