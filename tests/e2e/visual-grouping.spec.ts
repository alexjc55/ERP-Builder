import { expect, test } from "@playwright/test";

// No real API traffic or database access: exercise the actual routed EntityRecords UI.
for (const defaultExpanded of [false, true]) {
  test(`group toggles stay local with defaultExpanded=${defaultExpanded}`, async ({ page }) => {
    const entityId = 987654, pageId = 987655;
    const entity = { id: entityId, entityKey: "visual_group_fixture", nameJson: { en: "Fixture" }, isActive: true, allowNoStatus: true, defaultPageSize: 50, pivotEnabled: false };
    const mirror = { id: pageId, path: "/visual-groups", nameJson: { en: "Visual groups" }, mirrorEntityId: entityId, groupByFieldKey: "category", groupDefaultExpanded: defaultExpanded, isActive: true, defaultPageSize: 50 };
    const queries: Record<string, unknown>[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-visual-grouping"));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({
        id: 1, email: "fixture@example.test", firstName: "Browser", roleId: 1, roleIds: [1], language: defaultExpanded ? "he" : "en", direction: defaultExpanded ? "rtl" : "ltr", isActive: true,
        permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: { [entityId]: { view: true, update: true, scope: "all" } } },
      });
      if (path === "/api/pages") return reply([mirror]);
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/settings") return reply({ defaultLanguage: "en", timeZone: "UTC", firstDayOfWeek: 1 });
      if (path === `/api/entities/${entityId}/fields`) return reply([
        { id: 1, entityId, fieldKey: "title", nameJson: { en: "Title" }, fieldType: "text", sortOrder: 0, isActive: true, showInTable: true, permissionsJson: { "1": "view" } },
        { id: 2, entityId, fieldKey: "category", nameJson: { en: "Category" }, fieldType: "text", sortOrder: 1, isActive: true, showInTable: true, permissionsJson: { "1": "view" } },
        { id: 3, entityId, fieldKey: "amount", nameJson: { en: "Amount" }, fieldType: "number", sortOrder: 2, isActive: true, showInTable: true, showColumnTotal: true, permissionsJson: { "1": "view" } },
      ]);
      if (path === `/api/pages/${pageId}/views`) return reply([{ id: 99, entityId, pageId, nameJson: { en: "All" }, isDefault: true, sortOrder: 0, configJson: {} }]);
      if (path === `/api/entities/${entityId}/records/query`) {
        const query = route.request().postDataJSON();
        queries.push(query);
        const ids = query.page === 2 ? [51, 52, 53] : [1, 2, 3];
        return reply({
          data: ids.map((id, i) => ({ id, entityId, statusId: null, valuesJson: { title: `Member ${id}`, category: ["A", "B", null][i], amount: 10 }, version: 1, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" })),
          total: 53, numericTotals: { amount: 530 },
          groups: ["A", "B", null].map((key, index) => ({ key, label: key, count: index === 2 ? 17 : 18, sums: { amount: index === 2 ? 170 : 180 } })),
          rowGroups: Object.fromEntries(ids.map((id, i) => [id, ["A", "B", null][i]])),
        });
      }
      if (path.includes("/collaboration/")) return route.abort();
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      if (path.endsWith("/record-values/query")) return reply([]);
      if (path.endsWith("/widgets")) return reply([]);
      return reply([]);
    });
    await page.goto("/visual-groups");
    await expect(page.locator("html")).toHaveAttribute("dir", defaultExpanded ? "rtl" : "ltr");
    const a = page.locator('tr[data-group-key="A"]');
    const b = page.locator('tr[data-group-key="B"]');
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    const member = (id: number) => page.locator(`[data-testid="record-cell"][data-record-id="${id}"][data-field-key="title"]`);
    await expect(member(1)).toHaveCount(defaultExpanded ? 1 : 0);
    await page.waitForTimeout(400);
    const baseline = queries.length;
    expect(queries.at(-1)).toMatchObject({ grouped: true, withRowGroups: true, page: 1, pageSize: 50, pageId });
    expect(queries.at(-1)).not.toHaveProperty("groupValue");
    const totals = page.locator("thead tr").first();
    await expect(totals).toContainText("530");
    const y = (await page.locator("table").last().boundingBox())!.y;
    await a.click();
    await expect(member(1)).toHaveCount(defaultExpanded ? 0 : 1);
    await expect(member(2)).toHaveCount(defaultExpanded ? 1 : 0);
    await b.click();
    await expect(member(1)).toHaveCount(defaultExpanded ? 0 : 1);
    await expect(member(2)).toHaveCount(defaultExpanded ? 0 : 1);
    await a.click();
    await expect(member(1)).toHaveCount(defaultExpanded ? 1 : 0);
    await expect(totals).toContainText("530");
    expect((await page.locator("table").last().boundingBox())!.y).toBe(y);
    await page.getByRole("button", { name: /Развернуть все группы|Expand all groups/ }).click();
    await expect(member(1)).toBeVisible();
    await expect(member(2)).toBeVisible();
    await expect(member(3)).toBeVisible();
    expect(await member(1).evaluate(cell => cell.closest("tr")!.previousElementSibling?.getAttribute("data-group-key"))).toBe("A");
    expect(await member(2).evaluate(cell => cell.closest("tr")!.previousElementSibling?.getAttribute("data-group-key"))).toBe("B");
    const emptyHeader = page.locator("tr[data-group-key]").nth(2);
    await emptyHeader.click();
    await expect(member(3)).toHaveCount(0);
    await expect(member(1)).toBeVisible();
    await emptyHeader.click();
    await expect(member(3)).toBeVisible();
    await page.getByRole("button", { name: /Свернуть все группы|Collapse all groups/ }).click();
    await expect(member(1)).toHaveCount(0);
    await expect(member(2)).toHaveCount(0);
    await expect(member(3)).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(queries).toHaveLength(baseline);
    // Paging remains available when all groups are closed; local toggles on
    // page 2 must neither fetch nor jump back to page 1.
    await page.getByRole("button", { name: /Вперёд|Next/ }).click();
    await expect.poll(() => queries.at(-1)?.page).toBe(2);
    await expect(a).toBeVisible();
    const pageTwoQueries = queries.length;
    await a.click();
    await expect(member(51)).toBeVisible();
    await expect(member(1)).toHaveCount(0);
    await b.click();
    await expect(member(52)).toBeVisible();
    await expect(member(51)).toBeVisible();
    await page.waitForTimeout(300);
    expect(queries).toHaveLength(pageTwoQueries);
    expect(queries.at(-1)?.page).toBe(2);
    await expect(totals).toContainText("530");
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/visual-groups-${defaultExpanded}.png` });
  });
}