import { expect, test } from "@playwright/test";

for (const embedded of [true, false]) for (const language of ["ru", "he"]) {
  test(`compact analytics unit and responsive spans: embedded=${embedded}, ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1100 });
    const pageId = 987620, entityId = 987621;
    let writes = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let widgets = [1, 2, 4].map((gridW, i) => ({
      id: 987630 + i, pageId, titleJson: { ru: `Ширина ${gridW}`, he: `רוחב ${gridW}` }, icon: "",
      gridW, gridH: 1, sortOrder: i, visibleRoleIds: null,
      config: { widgetType: "metric", format: "number", metrics: [{ key: "count", entityId, aggregation: "count" }] },
    }));
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-compact"));
    await page.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", language, isActive: true,
        permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
      if (path === "/api/pages") return reply([{ id: pageId, path: "/compact-fixture", nameJson: { ru: "Аналитика", he: "ניתוח" },
        isActive: true, isDashboard: !embedded, mirrorEntityId: embedded ? entityId : null }]);
      const entity = { id: entityId, pageId, entityKey: "compact_fixture", nameJson: { ru: "Заказы" }, isActive: true };
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/settings") return reply({ defaultLanguage: language, timeZone: "UTC" });
      if (path.endsWith("/fields")) return reply([{ id: 1, entityId, fieldKey: "name", fieldType: "text", nameJson: { ru: "Название" }, isActive: true, showInTable: true }]);
      if (path === `/api/pages/${pageId}/dashboard/data`) return reply(widgets.map(w => ({ ...w, ...w.config, metrics: { count: 313 } })));
      if (path === `/api/pages/${pageId}/dashboard/widgets`) return reply(widgets);
      if (path.startsWith("/api/dashboard/widgets/") && req.method() === "PUT") {
        const id = Number(path.split("/").at(-1));
        widgets = widgets.map(w => w.id === id ? { ...w, ...req.postDataJSON() } : w);
        writes++;
        return reply(widgets.find(w => w.id === id));
      }
      if (path.endsWith("/records/query")) return reply({ data: [], total: 0, numericTotals: {} });
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      if (path.includes("/collaboration/")) return route.abort();
      return reply([]);
    });
    await page.goto("/compact-fixture");
    const grid = page.getByTestId("widget-grid");
    const dimensions = () => grid.evaluate(el => ({
      width: el.clientWidth,
      tracks: getComputedStyle(el).gridTemplateColumns.split(" ").map(Number.parseFloat),
      children: [...el.children].slice(0, 3).map(child => {
        const r = child.getBoundingClientRect();
        return { width: r.width, x: r.x, right: r.right };
      }),
      x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right,
      overflow: el.scrollWidth > el.clientWidth + 1,
    }));
    await expect(grid).toBeVisible();
    await expect.poll(async () => (await dimensions()).children.length).toBe(3);
    const viewer = await dimensions();
    if (embedded) {
      expect(viewer.children.map(c => c.width)).toEqual([260, 536, 1088]);
      expect(viewer.tracks.every(track => track === 260)).toBe(true);
      expect(language === "he" ? viewer.children[0].right : viewer.children[0].x)
        .toBe(language === "he" ? viewer.right : viewer.x);
    } else {
      expect(viewer.tracks).toHaveLength(4);
      expect(viewer.children[0].width).toBeGreaterThan(300);
      expect(viewer.children[2].width).toBeCloseTo(viewer.width, 0);
    }
    if (embedded) {
      await page.screenshot({ path: test.info().outputPath("compact-initial.png") });
      const collapse = page.getByRole("button", { name: "Аналитика", exact: true });
      await collapse.click();
      await expect(grid).toHaveCount(0);
      await collapse.click();
      await expect(grid).toBeVisible();
      expect((await dimensions()).children.map(c => c.width)).toEqual([260, 536, 1088]);
    }
    await page.getByRole("button", { name: "Настроить", exact: true }).first().click();
    await expect(grid.locator("[title='Ширина (ячеек)']")).toHaveCount(3);
    expect((await dimensions()).children.map(c => c.width)).toEqual(viewer.children.map(c => c.width));
    await grid.locator("[title='Ширина (ячеек)']").first().getByRole("button").last().click();
    await expect.poll(() => writes).toBe(1);
    await expect.poll(async () => (await dimensions()).children[0].width).toBe(viewer.children[1].width);
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await page.reload();
    await expect.poll(async () => (await dimensions()).children[0].width).toBe(viewer.children[1].width);
    if (embedded) {
      // Container changes (not just viewport breakpoints) cap saved widths.
      const root = page.locator(".embedded-widget-container");
      for (const width of [800, 535, 220]) {
        await root.evaluate((el, px) => { (el as HTMLElement).style.width = `${px}px`; }, width);
        const expected = width >= 536 ? 536 : Math.min(260, width);
        await expect.poll(async () => (await dimensions()).children[2].width).toBe(expected);
        expect((await dimensions()).overflow).toBe(false);
      }
      await root.evaluate(el => { (el as HTMLElement).style.width = ""; });
      await page.setViewportSize({ width: 402, height: 874 });
      await expect.poll(async () => (await dimensions()).children[2].width).toBe(260);
      expect((await dimensions()).overflow).toBe(false);
      await page.getByRole("button", { name: "Настроить", exact: true }).first().click();
      await expect(grid.locator("[title='Ширина (ячеек)']")).toHaveCount(3);
      expect((await dimensions()).children.map(c => c.width)).toEqual([260, 260, 260]);
      expect(widgets.map(w => w.gridW)).toEqual([2, 2, 4]);
      expect(writes).toBe(1);
      await page.getByRole("button", { name: "Готово", exact: true }).click();
      await page.screenshot({ path: test.info().outputPath("compact-mobile.png") });
      await page.setViewportSize({ width: 1800, height: 1100 });
      await expect.poll(async () => (await dimensions()).children[2].width).toBe(1088);
      await page.screenshot({ path: test.info().outputPath("compact-desktop.png") });
    }
    expect(errors).toEqual([]);
  });
}