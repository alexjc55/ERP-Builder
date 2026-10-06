import { expect, test } from "@playwright/test";

// Only this browser's network is mocked. Real server auth is never bypassed.
async function openSettings(page: import("@playwright/test").Page, superAdmin = true, fail = false) {
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem("erp_token", "browser-test-token"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      writes.push(path);
      return route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: "Test error" } : { success: true } });
    }
    if (path.endsWith("/auth/me")) return route.fulfill({ json: {
      id: 1, email: "ui@session-test.invalid", firstName: "Test", lastName: "User", roleId: 1,
      roleIds: [1], roleName: { ru: "Тест" }, language: "ru", direction: "ltr",
      isActive: true, isGuest: false, impersonator: null,
      permissions: { superAdmin, admin: {}, records: {}, pageIds: [] },
    } });
    if (path.endsWith("/settings") || path.endsWith("/settings/public")) return route.fulfill({ json: {
      appNameJson: { ru: "ERP" }, defaultLanguage: "ru", workingDays: [1,2,3,4,5],
    } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/settings");
  await expect(page.getByText("Безопасность сессий", { exact: true })).toBeVisible();
  return writes;
}

test("session logout requires confirmation and clears local identity", async ({ page }) => {
  const writes = await openSettings(page);
  await page.getByRole("button", { name: "Завершить все мои сессии", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Отмена", exact: true }).click();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Завершить все мои сессии", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Завершить сессии", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("erp_token"))).toBeNull();
  expect(writes).toContain("/api/auth/revoke-sessions");
});

test("super-admin global action warns about all users and sends the global endpoint", async ({ page }) => {
  const writes = await openSettings(page);
  await page.getByRole("button", { name: "Завершить сессии всех пользователей", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Несохранённые изменения");
  await page.getByRole("dialog").getByRole("button", { name: "Завершить сессии", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("erp_token"))).toBeNull();
  expect(writes).toContain("/api/auth/revoke-all-sessions");
});

test("ordinary account cannot see global logout; failed revoke preserves identity", async ({ page }) => {
  await openSettings(page, false, true);
  await expect(page.getByRole("button", { name: "Завершить сессии всех пользователей", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Завершить все мои сессии", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Завершить сессии", exact: true }).click();
  await expect(page.getByText("Не удалось отозвать сессии", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("erp_token"))).toBe("browser-test-token");
});

test("password change logs out the current browser", async ({ page }) => {
  const writes = await openSettings(page);
  const fields = page.locator('input[type="password"]');
  await fields.nth(0).fill("fixture-old-password");
  await fields.nth(1).fill("fixture-new-password");
  await fields.nth(2).fill("fixture-new-password");
  await page.getByRole("button", { name: "Сменить пароль", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("erp_token"))).toBeNull();
  expect(writes).toContain("/api/auth/change-password");
});
