import { expect, test } from "@playwright/test";

for (const embedded of [false, true]) for (const language of ["ru", "he"]) {
  test(`secondary scalar value persisted and independent (${embedded ? "embedded" : "dashboard"}, ${language})`, async ({ page }) => {
    const entityId = 987651, pageId = 987652, widgetId = 987653;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let saved: any;
    let widget: any = {
      id: widgetId, pageId, titleJson: { ru: "Заказов в работе", he: "הזמנות בעבודה" }, visibleRoleIds: null,
      icon: "", color: "#dbeafe", gridW: 1, gridH: 1, sortOrder: 0,
      config: { widgetType: "metric", format: "number", colorStyle: "fill", textColor: "dark",
        metrics: [
          { key: "orders", entityId, aggregation: "count", statusIds: [1] },
          { key: "total", entityId, aggregation: "sum", fieldKey: "amount", statusIds: [1] },
          { key: "ratio", entityId, aggregation: "count", statusIds: [] },
        ] },
    };
    const entity = { id: entityId, pageId, entityKey: "orders", nameJson: { ru: "Заказы", he: "הזמנות" }, isActive: true };
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-secondary"));
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", email: "fixture@example.test", language, isActive: true,
        permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
      if (path === "/api/pages") return reply([{ id: pageId, path: "/secondary-fixture", nameJson: { ru: "Показатели", he: "מדדים" }, isActive: true, isDashboard: !embedded, mirrorEntityId: embedded ? entityId : null }]);
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/settings") return reply({ defaultLanguage: language, currencySymbol: "₪", timeZone: "UTC" });
      if (path.endsWith("/fields")) return reply([{ id: 1, entityId, fieldKey: "amount", nameJson: { ru: "Сумма", he: "סכום" }, fieldType: "function", formulaConfigJson: { expression: "1" }, isActive: true, showInTable: true, sortOrder: 0, permissionsJson: {} }]);
      if (path.endsWith("/statuses")) return reply([{ id: 1, entityId, nameJson: { ru: "В работе", he: "בעבודה" }, color: "#00aa00" }]);
      if (path.endsWith("/relation-options")) return reply({ options: [] });
      if (path === `/api/pages/${pageId}/dashboard/widgets`) {
        if (request.method() === "POST") {
          saved = request.postDataJSON(); widget = { ...widget, ...saved }; return reply(widget);
        }
        return reply([widget]);
      }
      if (path === `/api/dashboard/widgets/${widgetId}` && request.method() === "PUT") {
        saved = request.postDataJSON(); widget = { ...widget, ...saved }; return reply(widget);
      }
      if (path === `/api/pages/${pageId}/dashboard/data`) return reply([{
        ...widget, ...widget.config, metrics: Object.fromEntries(widget.config.metrics.map((m: any, i: number) => [m.key, i === 0 ? 180 : i === 1 ? 1765000 : 25.5])),
      }]);
      if (path.endsWith("/records/query")) return reply({ data: [], total: 0, numericTotals: {} });
      if (path.endsWith("/record-values/query")) return reply([]);
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      if (path.includes("/collaboration/")) return route.abort();
      return reply([]);
    });
    const secondary = page.getByTestId("widget-secondary-value");
    const edit = async () => {
      await page.getByRole("button", { name: "Настроить", exact: true }).first().click();
      await page.getByTitle("Редактировать виджет", { exact: true }).click();
      return page.getByRole("dialog");
    };
    const save = async () => {
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Готово", exact: true }).click();
    };
    await page.goto("/secondary-fixture");
    await expect(page.getByText("180", { exact: true })).toBeVisible();
    await expect(secondary).toHaveCount(0);
    await edit();
    await page.getByTestId("toggle-secondary-value").click();
    await page.getByTestId("select-secondary-metric").click();
    await page.getByRole("option", { name: "total", exact: true }).click();
    await save();
    expect(saved.config.secondaryValue).toEqual({ metricKey: "total", captionJson: { ru: "На сумму:", en: "Total:", he: "בסכום:" }, format: "currency" });
    expect(saved.config.metrics[0].statusIds).toEqual([1]);
    await expect(secondary).toContainText(language === "ru" ? "На сумму:" : "בסכום:");
    await expect(secondary).toContainText(/1\s765\s000 ₪/);
    await expect(page.getByText("180", { exact: true })).toBeVisible();
    await page.reload();
    await expect(secondary).toContainText(/1\s765\s000 ₪/);
    await expect(page.locator("html")).toHaveAttribute("dir", language === "he" ? "rtl" : "ltr");
    await page.setViewportSize({ width: 402, height: 874 });
    expect(await secondary.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("secondary-value.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    const dialog = await edit();
    await expect(page.getByTestId("select-secondary-metric")).toHaveText("total");
    // Renaming the selected metric follows its identity; it never switches by index.
    await dialog.locator('input[value="total"]').fill("sum");
    const caption = language === "ru" ? "Общая стоимость:" : "עלות כוללת:";
    await dialog.getByPlaceholder(language === "ru" ? "Подпись дополнительного значения (Русский)" : "Подпись дополнительного значения (עברית)").fill(caption);
    await expect(page.getByTestId("select-secondary-metric")).toHaveText("sum");
    await save();
    expect(saved.config.secondaryValue.metricKey).toBe("sum");
    expect(saved.config.secondaryValue.captionJson[language]).toBe(caption);
    await expect(secondary).toContainText(caption);
    await expect(secondary).toContainText(/1\s765\s000 ₪/);
    await edit();
    await page.getByTestId("select-secondary-metric").click();
    await page.getByRole("option", { name: "ratio", exact: true }).click();
    await page.getByTestId("select-secondary-format").click();
    await page.getByRole("option", { name: "Процент", exact: true }).click();
    await save();
    await expect(secondary).toContainText("25,5%");
    await expect(page.getByText("180", { exact: true })).toBeVisible();
    // Deleting the referenced metric requires an explicit new choice, never an index fallback.
    const removing = await edit();
    await removing.getByRole("button", { name: "Удалить метрику ratio", exact: true }).click();
    await expect(page.getByTestId("select-secondary-metric")).toContainText("Выберите метрику");
    await removing.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(removing).toBeVisible();
    await expect(page.getByText("Выберите метрику для дополнительного значения", { exact: true })).toBeVisible();
    await page.getByTestId("select-secondary-metric").click();
    await page.getByRole("option", { name: "sum", exact: true }).click();
    await page.getByTestId("select-secondary-format").click();
    await page.getByRole("option", { name: "Число", exact: true }).click();
    await save();
    await expect(secondary).toContainText(/1\s765\s000/);
    await expect(secondary).not.toContainText("₪");
    await edit();
    await page.getByTestId("toggle-secondary-value").click();
    await save();
    expect(saved.config.secondaryValue).toBeUndefined();
    await expect(secondary).toHaveCount(0);
    await page.reload();
    await expect(secondary).toHaveCount(0);
    // The same optional config is included on the create path, not only edits.
    if (!embedded && language === "ru") {
      await page.getByRole("button", { name: "Настроить", exact: true }).click();
      await page.getByRole("button", { name: "Добавить виджет", exact: true }).first().click();
      const creating = page.getByRole("dialog");
      await creating.getByPlaceholder("Заголовок (Русский)").fill("Новый показатель");
      await creating.getByRole("combobox").filter({ hasText: "Сущность" }).last().click();
      await page.getByRole("option", { name: "Заказы", exact: true }).click();
      await page.getByTestId("toggle-secondary-value").click();
      await page.getByTestId("select-secondary-metric").click();
      await page.getByRole("option", { name: "m1", exact: true }).click();
      await save();
      expect(saved.config.secondaryValue.metricKey).toBe("m1");
      await page.reload();
      await expect(secondary).toContainText("180 ₪");
    }
    expect(errors).toEqual([]);
  });
}