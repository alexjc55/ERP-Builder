import { expect, test } from "@playwright/test";

for (const scenario of [
  { admin: true, pinned: false, widths: false, rows: 2 },
  { admin: false, pinned: false, widths: false, rows: 2 },
  { admin: false, pinned: true, widths: false, rows: 2 },
  { admin: false, pinned: true, widths: true, rows: 2 },
  { admin: false, pinned: false, widths: true, rows: 0 },
]) {
  test(`wide delivery table scrolls ${JSON.stringify(scenario)}`, async ({ page }) => {
    let { admin } = scenario;
    const { pinned, widths } = scenario;
    const entityId = 987654, pageId = 987655;
    await page.addInitScript(({ entityId, pageId, widths }) => {
      localStorage.setItem("erp_token", "scroll-fixture");
      if (widths) localStorage.setItem(`erp:colwidths:${entityId}:${pageId}`, JSON.stringify(Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`f:${i + 1}`, 180]))));
    }, { entityId, pageId, widths });
    const entity = { id: entityId, pageId, entityKey: "delivery", nameJson: { en: "Delivery" }, isActive: true, allowNoStatus: true, defaultPageSize: 50 };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/stop-impersonation") {
        admin = true;
        return reply({ token: "scroll-admin-token" });
      }
      if (path === "/api/auth/me") return reply({
        id: admin ? 1 : 2, email: "scroll@example.test", firstName: "Scroll", roleId: admin ? 1 : 2, roleIds: [admin ? 1 : 2], language: "en", direction: "ltr", isActive: true,
        ...(!admin ? { impersonator: { id: 1, name: "Admin" } } : {}),
        permissions: { superAdmin: admin, pageIds: [pageId], admin: {}, records: { [entityId]: { view: true, update: true, scope: admin ? "all" : "own", hideStatusColumn: !admin, hideActionsColumn: !admin } } },
      });
      if (path === "/api/pages") return reply([{ id: pageId, path: "/scroll-fixture", nameJson: { en: "Delivery" }, isActive: true }]);
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/settings") return reply({ defaultLanguage: "en", timeZone: "UTC" });
      if (path === `/api/entities/${entityId}/fields`) return reply(Array.from({ length: 14 }, (_, i) => ({ id: i + 1, entityId, fieldKey: `field${i}`, nameJson: { en: `Delivery field ${i}` }, fieldType: "text", sortOrder: i, isActive: true, showInTable: true, isPinned: pinned, permissionsJson: {} })));
      if (path.endsWith("/statuses")) return reply([{ id: 1, entityId, nameJson: { en: "Done" }, color: "#00ff00", sortOrder: 0 }]);
      if (path.endsWith("/views")) return reply([{ id: 99, entityId, pageId, nameJson: { en: "All" }, isDefault: true, sortOrder: 0, configJson: {} }]);
      if (path.endsWith("/records/query")) return reply({ data: [1, 2].slice(0, scenario.rows).map(id => ({ id, entityId, statusId: 1, valuesJson: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`field${i}`, `Delivery value ${i} content`])), version: 1, archivedAt: null })), total: scenario.rows, numericTotals: {} });
      if (path.includes("/collaboration/")) return route.abort();
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      return reply([]);
    });
    await page.goto("/scroll-fixture");
    await expect(page.getByRole("columnheader", { name: /Delivery field 0/ })).toBeVisible();
    const scroll = page.locator("div.overflow-auto").filter({ has: page.locator("table") }).last();
    expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await scroll.evaluate(el => { el.scrollLeft = 300; });
    expect(await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    // The final visible data column remains reachable, including all-pinned roles.
    expect(await scroll.evaluate(el => Array.from(el.querySelectorAll("thead th")).at(-1)!.getBoundingClientRect().right <= el.getBoundingClientRect().right + 2)).toBe(true);
    await scroll.evaluate(el => { el.scrollLeft = 0; });
    const box = (await scroll.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 200);
    await page.keyboard.up("Shift");
    await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    if (!admin) {
      await page.getByRole("button", { name: /Вернуться к Admin|Return to Admin/ }).click();
      await expect(page.getByRole("columnheader", { name: /Статус|Status/ })).toBeVisible();
      expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await scroll.evaluate(el => { el.scrollLeft = 300; });
      expect(await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
  });
}