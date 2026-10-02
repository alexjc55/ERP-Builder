import { expect, test } from "@playwright/test";

test("status flags show default hiding alongside final and tags, only when enabled", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("erp_token", "mock-status-flags"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path === "/api/auth/me") return reply({
      id: 1, firstName: "Test", roleId: 1, roleIds: [1], language: "ru", isActive: true,
      permissions: { superAdmin: true, admin: {}, records: {}, pageIds: [] },
    });
    if (path === "/api/settings") return reply({ defaultLanguage: "ru" });
    if (path === "/api/entities") return reply([{ id: 987670, nameJson: { ru: "Тест" }, isActive: true }]);
    if (path === "/api/tags") return reply([{ id: 1, nameJson: { ru: "Производство" }, color: "#2563eb", isActive: true, applicableTo: ["statuses"] }]);
    if (path.endsWith("/statuses")) return reply([
      { id: 1, nameJson: { ru: "Скрытый финальный" }, hideByDefault: true, isFinal: true, tagIds: [1] },
      { id: 2, nameJson: { ru: "Только скрытый" }, hideByDefault: true, tagIds: [] },
      { id: 3, nameJson: { ru: "Обычный" }, hideByDefault: false, tagIds: [] },
      { id: 4, nameJson: { ru: "Без флага" }, tagIds: [] },
    ].map((status, i) => ({ isActive: true, isDefault: false, isArchiveTrigger: false, color: "#2563eb", sortOrder: i, statusKey: `status_${i}`, ...status })));
    return reply([]);
  });
  await page.goto("/admin/entities/987670/statuses");
  const hidden = page.getByRole("row").filter({ hasText: "Скрытый финальный" });
  await expect(hidden.getByTestId("status-hidden-by-default")).toHaveText("Скрывать по умолчанию");
  await expect(hidden).toContainText("Финальный");
  await expect(hidden).toContainText("Производство");
  const onlyHidden = page.getByRole("row").filter({ hasText: "Только скрытый" });
  await expect(onlyHidden.getByTestId("status-hidden-by-default")).toBeVisible();
  await expect(onlyHidden.getByText("—", { exact: true })).toHaveCount(0);
  for (const name of ["Обычный", "Без флага"]) {
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByTestId("status-hidden-by-default")).toHaveCount(0);
    await expect(row.getByText("—", { exact: true })).toBeVisible();
  }
});