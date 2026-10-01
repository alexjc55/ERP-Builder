import { expect, test } from "@playwright/test";

for (const embedded of [false, true]) {
  for (const source of ["entity", "page"] as const) {
    test(`formula SUM editor persists and renders: embedded=${embedded}, source=${source}`, async ({ page }) => {
      const entityId = 987654, pageId = 987655, widgetId = 987656;
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let saved: any;
      let failCompute = false;
      let widget = {
        id: widgetId, pageId, titleJson: { en: "Order total" }, visibleRoleIds: null, icon: "BarChart3", color: "#3b82f6",
        gridW: 1, gridH: 1, sortOrder: 0, config: {
          widgetType: "metric", format: "number", metrics: [{
            key: "value", source, entityId: source === "entity" ? entityId : 0,
            pageId: source === "page" ? pageId : null, aggregation: "sum", fieldKey: "price",
            statusIds: source === "entity" ? [1] : null, statusTagIds: null,
          }],
        },
      };
      const entity = { id: entityId, pageId, entityKey: "orders_fixture", nameJson: { en: "Orders" }, isActive: true };
      const fields = [
        { id: 1, fieldKey: "price", nameJson: { en: "Stored price" }, fieldType: "number", formulaConfigJson: {} },
        { id: 2, fieldKey: "computed", nameJson: { en: "Computed total" }, fieldType: "function", formulaConfigJson: { expression: "{price}*2", decimals: 2 } },
        { id: 3, fieldKey: "comment", nameJson: { en: "Text comment" }, fieldType: "text" },
      ].map(field => ({ ...field, entityId, pageId, isActive: true, showInTable: true, sortOrder: field.id, permissionsJson: {} }));
      await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-widget-formula"));
      await page.route("**/api/**", async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        if (path === "/api/auth/me") return reply({
          id: 1, roleId: 1, roleIds: [1], firstName: "Tester", email: "widget@example.test", language: "ru", isActive: true,
          permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} },
        });
        if (path === "/api/pages") return reply([{
          id: pageId, path: "/widget-formula-fixture", nameJson: { en: "Formula widgets" }, isActive: true,
          isDashboard: !embedded, mirrorEntityId: embedded ? entityId : null,
        }]);
        if (path === "/api/entities") return reply([entity]);
        if (path === `/api/entities/${entityId}`) return reply(entity);
        if (path === "/api/settings") return reply({ defaultLanguage: "ru", timeZone: "UTC", currencySymbol: "₪" });
        if (path === `/api/entities/${entityId}/fields` || path === `/api/pages/${pageId}/fields`) return reply(fields);
        if (path.endsWith("/statuses")) return reply([{ id: 1, entityId, nameJson: { en: "Open" }, color: "#00aa00" }]);
        if (path.endsWith("/relation-options")) return reply({ options: [] });
        if (path === `/api/pages/${pageId}/dashboard/widgets`) return reply([widget]);
        if (path === `/api/dashboard/widgets/${widgetId}` && req.method() === "PUT") {
          saved = req.postDataJSON();
          widget = { ...widget, ...saved };
          return reply(widget);
        }
        if (path === `/api/pages/${pageId}/dashboard/data`) {
          if (failCompute) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: 'Cannot sum formula "computed": every non-empty result must be a finite number.' }) });
          return reply([{ ...widget, widgetType: "metric", format: "number", metrics: { value: widget.config.metrics[0].fieldKey === "computed" ? 530 : 265 } }]);
        }
        if (path.endsWith("/records/query")) return reply({ data: [], total: 0, numericTotals: {} });
        if (path.endsWith("/record-values/query")) return reply([]);
        if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
        if (path.includes("/collaboration/")) return route.abort();
        return reply([]);
      });
      await page.goto("/widget-formula-fixture");
      await expect(page.getByText("Order total", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Настроить", exact: true }).first().click();
      await page.getByTitle("Редактировать виджет", { exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox").filter({ hasText: "Stored price" }).click();
      await expect(page.getByRole("option", { name: "Text comment", exact: true })).toHaveCount(0);
      await page.getByRole("option", { name: "Computed total", exact: true }).click();
      await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(saved.config.metrics[0]).toMatchObject({ source, aggregation: "sum", fieldKey: "computed" });
      if (source === "entity") expect(saved.config.metrics[0].statusIds).toEqual([1]);
      else expect(saved.config.metrics[0].pageId).toEqual(pageId);
      await page.getByRole("button", { name: "Готово", exact: true }).click();
      await expect(page.getByText("530", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText("530", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Настроить", exact: true }).first().click();
      await page.getByTitle("Редактировать виджет", { exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("combobox").filter({ hasText: "Computed total" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Готово", exact: true }).click();
      await page.screenshot({ path: test.info().outputPath("formula-metric.png") });
      failCompute = true;
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: 'Cannot sum formula "computed"' })).toBeVisible({ timeout: 20_000 });
      expect(errors).toEqual([]);
    });
  }
}