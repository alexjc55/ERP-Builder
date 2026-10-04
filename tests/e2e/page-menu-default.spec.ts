import { test, expect } from "@playwright/test";

test("menu group uses configured default after reload and allows manual toggling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let expanded = false;
  await page.addInitScript(() => localStorage.setItem("erp_token", "menu-test"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me") data = { id: 1, roleId: 1, roleIds: [1], language: "en", isActive: true, permissions: { superAdmin: true, admin: {}, records: {} } };
    if (path === "/api/settings") data = { defaultLanguage: "en" };
    if (path === "/api/pages") data = [
      { id: 1, nameJson: { en: "Administration fixture" }, isSystem: true, isActive: true, sortOrder: 0, menuDefaultExpanded: expanded },
      { id: 2, parentPageId: 1, nameJson: { en: "Pages fixture" }, isSystem: true, path: "/admin/pages", isActive: true, sortOrder: 1 },
      { id: 3, nameJson: { en: "Legacy group" }, isActive: true, sortOrder: 2 },
      { id: 4, parentPageId: 3, nameJson: { en: "Legacy child" }, path: "/admin/entities", isActive: true, sortOrder: 3 },
    ];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/admin/pages");
  const group = page.getByRole("button", { name: "Administration fixture", exact: true }).first();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Legacy group", exact: true }).first()).toHaveAttribute("aria-expanded", "true");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  const systemRow = page.getByRole("row").filter({ hasText: "Administration fixture" });
  await expect(systemRow).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Legacy group" }).locator("button.text-red-500")).toHaveCount(1);
  await page.getByRole("tab", { name: /^(Системные|System)$/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "Legacy group" })).toHaveCount(0);
  await expect(systemRow.locator("button.text-red-500")).toHaveCount(0);
  await systemRow.locator("button").last().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#page-active")).toHaveCount(0);
  await expect(dialog.locator('input[placeholder="/example"]')).toHaveCount(0);
  await expect(dialog.getByTestId("page-menu-default-state")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  expanded = true;
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "true");
});