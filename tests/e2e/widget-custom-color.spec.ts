import { expect, test } from "@playwright/test";

for (const embedded of [false, true]) for (const language of ["ru", "he"]) {
  test(`widget custom color persists and styles all scalar surfaces (${embedded}, ${language})`, async ({ page }) => {
    const entityId = 987661, pageId = 987662, widgetId = 987663;
    let writes = 0;
    let widget: any = {
      id: widgetId, pageId, titleJson: { ru: "Цветной показатель", he: "מדד צבעוני" }, visibleRoleIds: null,
      icon: "TrendingUp", color: "bg-violet-600", gridW: 1, gridH: 1, sortOrder: 0,
      config: { widgetType: "metric", format: "number", colorStyle: "border", textColor: "dark",
        metrics: [{ key: "orders", source: "entity", entityId, aggregation: "count" }] },
    };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("erp_token", "mock-custom-color"));
    const entity = { id: entityId, pageId, entityKey: "orders", nameJson: { ru: "Заказы", he: "הזמנות" }, isActive: true };
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", language, isActive: true,
        permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
      if (path === "/api/pages") return reply([{ id: pageId, path: "/color-fixture", nameJson: { ru: "Цвета", he: "צבעים" }, isActive: true, isDashboard: !embedded, mirrorEntityId: embedded ? entityId : null }]);
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/settings") return reply({ defaultLanguage: language, currencySymbol: "₪", timeZone: "UTC" });
      if (path === `/api/pages/${pageId}/dashboard/widgets`) {
        if (request.method() === "POST") { widget = { ...widget, ...request.postDataJSON() }; writes++; return reply(widget); }
        return reply([widget]);
      }
      if (path === `/api/dashboard/widgets/${widgetId}` && request.method() === "PUT") {
        widget = { ...widget, ...request.postDataJSON() }; writes++; return reply(widget);
      }
      if (path.endsWith("/dashboard/data")) return reply([{ ...widget, ...widget.config, metrics: { orders: 49 } }]);
      if (path.endsWith("/records/query")) return reply({ data: [], total: 0, numericTotals: {} });
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      if (path.includes("/collaboration/")) return route.abort();
      return reply([]);
    });
    const title = () => page.getByText(widget.titleJson[language], { exact: true });
    const card = () => title().locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    const edit = async () => {
      await page.getByRole("button", { name: "Настроить", exact: true }).first().click();
      await page.getByTitle("Редактировать виджет", { exact: true }).click();
    };
    const save = async () => {
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Готово", exact: true }).click();
    };
    const input = () => page.getByTestId("widget-custom-color").getByPlaceholder("#RRGGBB");
    await page.goto("/color-fixture");
    await expect(title()).toBeVisible();
    const presetBorder = await card().evaluate(el => getComputedStyle(el).borderTopColor);
    await edit();
    await expect(input()).toHaveValue("#7c3aed");
    await input().fill("#BADHEX");
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("#RRGGBB");
    expect(writes).toBe(0);
    await input().fill("#a3c8ef");
    await save();
    expect(widget.color).toBe("#A3C8EF");
    await expect(card()).toHaveCSS("border-top-color", "rgb(163, 200, 239)");
    await page.reload();
    await expect(card()).toHaveCSS("border-top-color", "rgb(163, 200, 239)");
    await edit();
    await expect(input()).toHaveValue("#A3C8EF");
    await page.getByRole("dialog").getByRole("button", { name: "Заливка", exact: true }).click();
    await save();
    await expect(card()).toHaveCSS("background-color", "rgb(163, 200, 239)");
    expect(widget.config.textColor).toBe("dark");
    await page.screenshot({ path: test.info().outputPath("widget-custom-fill.png"), animations: "disabled" });
    await edit();
    await page.getByRole("dialog").getByRole("button", { name: "Иконка", exact: true }).click();
    await save();
    await expect(card().locator("div.w-12")).toHaveCSS("background-color", "rgb(163, 200, 239)");
    await edit();
    // Reusing the shared picker provides both a graphical picker and HEX text.
    await page.getByTestId("widget-custom-color").getByRole("button", { name: "Выбрать цвет", exact: true }).click();
    await expect(page.locator(".react-colorful")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("widget-custom-picker.png"), animations: "disabled" });
    await page.locator(".react-colorful__saturation").click({ position: { x: 40, y: 35 } });
    await page.getByTestId("widget-custom-color").getByRole("button", { name: "Выбрать цвет", exact: true }).click();
    await expect(page.locator(".react-colorful")).toHaveCount(0);
    await save();
    expect(widget.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(widget.color).not.toBe("#A3C8EF");
    await edit();
    await page.getByRole("dialog").getByRole("button", { name: "bg-violet-600", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Обводка", exact: true }).click();
    await save();
    expect(widget.color).toBe("bg-violet-600");
    await expect(card()).toHaveCSS("border-top-color", presetBorder);
    await page.screenshot({ path: test.info().outputPath("widget-color.png") });
    if (!embedded && language === "ru") {
      await page.getByRole("button", { name: "Настроить", exact: true }).click();
      await page.getByRole("button", { name: "Добавить виджет", exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByPlaceholder("Заголовок (Русский)").fill("Новый цвет");
      await dialog.getByRole("combobox").filter({ hasText: "Сущность" }).last().click();
      await page.getByRole("option", { name: "Заказы", exact: true }).click();
      await input().fill("#123abc");
      await dialog.getByRole("button", { name: "Заливка", exact: true }).click();
      await save();
      expect(widget.color).toBe("#123ABC");
      await page.reload();
      await expect(card()).toHaveCSS("background-color", "rgb(18, 58, 188)");
    }
    expect(errors).toEqual([]);
  });
}

test("custom widget color feeds chart strokes/fills, preserving status colors and legacy fallback", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("erp_token", "mock-chart-colors"));
  const widgets = ["line", "area", "bar"].map((chartType, i) => ({
    id: i + 1, pageId: 987662, titleJson: { ru: chartType }, gridW: 1, gridH: 2, sortOrder: i,
    widgetType: "chart", chartType, color: "#123ABC", series: [{ label: "A", value: 4 }, { label: "B", value: 6, color: "#ff0000" }],
  }));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, language: "ru", permissions: { superAdmin: true, pageIds: [987662], admin: {}, records: {} } });
    if (path === "/api/pages") return reply([{ id: 987662, path: "/color-chart-fixture", nameJson: { ru: "Диаграммы" }, isDashboard: true, isActive: true }]);
    if (path === "/api/settings") return reply({ defaultLanguage: "ru", timeZone: "UTC" });
    if (path.endsWith("/dashboard/data")) return reply(widgets);
    if (path.includes("/collaboration/")) return route.abort();
    return reply([]);
  });
  await page.goto("/color-chart-fixture");
  await expect(page.locator('.recharts-line-curve[stroke="#123ABC"]')).toBeVisible();
  await expect(page.locator('.recharts-area-area[fill="#123ABC"]')).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle path[fill="#123ABC"]')).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle path[fill="#ff0000"]')).toBeVisible();
});