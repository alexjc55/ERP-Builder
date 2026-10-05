import { expect, test } from "@playwright/test";

test("webhook test uses draft URL, does not save, reports failures, rejects email URLs", async ({ page }) => {
  const sent: unknown[] = [];
  let saves = 0;
  await page.addInitScript(() => localStorage.setItem("erp_token", "mock-webhook-test"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], language: "ru",
      permissions: { superAdmin: true, admin: { automations: true }, records: {}, pageIds: [] } });
    if (path === "/api/settings") return reply({ defaultLanguage: "ru" });
    if (path === "/api/entities/72") return reply({ id: 72, nameJson: { ru: "Изделия" }, entityKey: "items" });
    if (path === "/api/entities") return reply([{ id: 72, nameJson: { ru: "Изделия" }, entityKey: "items" }]);
    if (path === "/api/entities/72/automations") return reply([{ id: 1, entityId: 72, nameJson: { ru: "Отправка" },
      isActive: true, triggerJson: { type: "record_created" }, conditionsJson: [], sortOrder: 0,
      actionsJson: [{ type: "webhook", url: "https://example.test/old", includeRecord: true, language: "ru" }] }]);
    if (path.endsWith("/webhook-test")) {
      sent.push(request.postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 250));
      return reply(sent.length === 1 ? { ok: true, statusCode: 200 } : { ok: false, statusCode: 410, error: "http_error" });
    }
    if (request.method() !== "GET") saves++;
    return reply([]);
  });
  await page.goto("/admin/entities/72/automations");
  await page.getByTestId("automation-edit").click();
  const url = page.getByPlaceholder("https://example.com/hook");
  await url.fill("https://example.test/current");
  const button = page.getByTestId("webhook-test-button");
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("webhook-test-result")).toContainText("HTTP 200");
  expect(sent).toEqual([{ url: "https://example.test/current", includeRecord: true, language: "ru" }]);
  expect(saves).toBe(0);
  await button.click();
  await expect(page.getByTestId("webhook-test-result")).toContainText("HTTP 410");
  await url.fill("https://email@example.test");
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("webhook-test-result")).toHaveCount(0);
  expect(sent).toHaveLength(2);
  await page.screenshot({ path: "screenshots/webhook-test-settings.png" });
});
