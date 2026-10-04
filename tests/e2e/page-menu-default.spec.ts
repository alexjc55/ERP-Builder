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
      { id: 1, nameJson: { en: "Administration fixture" }, isActive: true, sortOrder: 0, menuDefaultExpanded: expanded },
      { id: 2, parentPageId: 1, nameJson: { en: "Pages fixture" }, path: "/admin/pages", isActive: true, sortOrder: 1 },
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
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  expanded = true;
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "true");
});