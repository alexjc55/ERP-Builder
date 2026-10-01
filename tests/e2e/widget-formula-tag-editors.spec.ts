import { expect, test, type Page } from "@playwright/test";

const entityId = 987671, pageId = 987672, widgetId = 987673;
async function fixture(page: Page, config: any) {
  let widget: any = { id: widgetId, pageId, titleJson: { ru: "Тест расчёта" }, icon: "", color: "bg-blue-600",
    gridW: 2, gridH: 2, sortOrder: 0, visibleRoleIds: null, config };
  const entity = { id: entityId, entityKey: "orders", nameJson: { ru: "Заказы" }, isActive: true, pivotEnabled: true };
  const fields = (local: boolean) => [
    { id: 1, fieldKey: "price", fieldType: "number", nameJson: { ru: local ? "Цена страницы" : "Цена" } },
    { id: 2, fieldKey: "computed", fieldType: "function", nameJson: { ru: local ? "Формула страницы" : "Формула сущности" }, formulaConfigJson: { expression: "{price}*2" } },
    { id: 3, fieldKey: "text", fieldType: "text", nameJson: { ru: "Комментарий" } },
  ].map(f => ({ ...f, entityId, pageId, isActive: true, pivotEnabled: true, sortOrder: f.id, permissionsJson: {} }));
  await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-formula-tags"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", language: "ru", isActive: true,
      permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
    if (path === "/api/pages") return reply([{ id: pageId, path: "/formula-tags-fixture", nameJson: { ru: "Страница формул" }, isActive: true, mirrorEntityId: entityId }]);
    if (path === "/api/entities") return reply([entity]);
    if (path === `/api/entities/${entityId}`) return reply(entity);
    if (path === "/api/settings") return reply({ defaultLanguage: "ru", currencySymbol: "₪", timeZone: "UTC" });
    if (path === `/api/entities/${entityId}/fields`) return reply(fields(false));
    if (path === `/api/pages/${pageId}/fields`) return reply(fields(true));
    if (path === "/api/tags") return reply([{ id: 9, nameJson: { ru: "Производство" }, color: "#00aa00", applicableTo: ["statuses"] }]);
    if (path.endsWith("/statuses")) return reply([{ id: 1, entityId, nameJson: { ru: "В работе" }, color: "#00aa00", tagIds: [9],
      tags: [{ id: 9, nameJson: { ru: "Производство" }, color: "#00aa00" }] }]);
    if (path.endsWith("/relation-options")) {
      const aggregate = new URL(route.request().url()).searchParams.get("forAggregation") === "true";
      return reply({ options: [{
        relationId: 15, label: { ru: "Связь" }, relatedEntityLabel: { ru: "Проекты" }, relatedEntityId: 987699,
        fields: [
          { key: "price", label: { ru: "Цена связи" }, fieldType: "number", ...(aggregate ? { supportsSum: true } : {}) },
          ...(aggregate ? [{ key: "once", label: { ru: "Формула один раз" }, fieldType: "function", supportsSum: true }] : []),
          { key: "blank", label: { ru: "Пустая формула" }, fieldType: "function", ...(aggregate ? { supportsSum: false } : {}) },
        ],
      }] });
    }
    if (path.endsWith("/dashboard/widgets")) return reply([widget]);
    if (path === `/api/dashboard/widgets/${widgetId}` && route.request().method() === "PUT") {
      widget = { ...widget, ...route.request().postDataJSON() }; return reply(widget);
    }
    if (path.endsWith("/dashboard/data")) return reply([{ ...widget, ...widget.config, metrics: {},
      chartType: widget.config.chart?.type, series: [{ key: "9", label: "Производство", value: 530 }],
      pivot: { rows: [], cols: [], cells: [], grandTotal: 0, rowTotals: [], colTotals: [] } }]);
    if (path.endsWith("/records/query")) return reply({ data: [], total: 0, numericTotals: {} });
    if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
    if (path.includes("/collaboration/")) return route.abort();
    return reply([]);
  });
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
  await page.goto("/formula-tags-fixture");
  await expect(page.getByText("Тест расчёта", { exact: true })).toBeVisible();
  return { edit, save, saved: () => widget.config };
}

for (const source of ["entity", "page"]) for (const type of ["bar", "line", "area", "pie", "donut"]) {
  test(`chart configured formula and tag grouping persists (${source}, ${type})`, async ({ page }) => {
    const ctx = await fixture(page, { widgetType: "chart", chart: {
      type, source, pageId: source === "page" ? pageId : null, entityId: source === "page" ? 0 : entityId,
      aggregation: "sum", fieldKey: "price", groupBy: { kind: "status" }, statusIds: [], statusTagIds: [],
    } });
    const dialog = await ctx.edit();
    await dialog.getByRole("combobox").filter({ hasText: source === "page" ? "Цена страницы" : /^Цена$/ }).click();
    await expect(page.getByRole("option", { name: "Комментарий", exact: true })).toHaveCount(0);
    const formulaLabel = source === "page" ? "Формула страницы" : "Формула сущности";
    await page.getByRole("option", { name: formulaLabel, exact: true }).click();
    await dialog.getByRole("combobox").filter({ hasText: /^Статусу$/ }).click();
    await page.getByRole("option", { name: "Тегам статусов", exact: true }).click();
    await expect(dialog.getByText(/Итоги по тегам могут/)).toBeVisible();
    await dialog.getByRole("button", { name: "В работе", exact: true }).click();
    await dialog.getByRole("button", { name: "Не выбрано", exact: true }).click();
    await page.getByLabel("Производство", { exact: true }).check();
    await page.keyboard.press("Escape");
    await ctx.save();
    expect(ctx.saved().chart).toMatchObject({ source, type, fieldKey: "computed", groupBy: { kind: "statusTag" }, statusIds: [1], statusTagIds: [9] });
    await page.reload();
    const reopened = await ctx.edit();
    await expect(reopened.getByRole("combobox").filter({ hasText: formulaLabel })).toBeVisible();
    await expect(reopened.getByRole("combobox").filter({ hasText: /^Тегам статусов$/ })).toBeVisible();
    if (type === "bar") await page.screenshot({ path: test.info().outputPath("formula-tag-chart-settings.png") });
  });
}

for (const source of ["entity", "page"]) {
  test(`pivot configured formula with tag rows and columns persists (${source})`, async ({ page }) => {
    const ctx = await fixture(page, { widgetType: "pivot", pivot: { entityId, pageId,
      pivot: { rows: { source: "status" }, cols: { source: "status" }, measure: { agg: "sum", source, fieldKey: "price" } } } });
    const dialog = await ctx.edit();
    for (let i = 0; i < 2; i++) {
      await dialog.getByRole("combobox").filter({ hasText: /^Статус записи$/ }).first().click();
      await page.getByRole("option", { name: "Теги статусов", exact: true }).click();
    }
    await dialog.getByRole("combobox").filter({ hasText: source === "page" ? "Цена страницы" : /^Цена$/ }).click();
    await page.getByRole("option", { name: source === "page" ? /Формула страницы/ : "Формула сущности", exact: source === "entity" }).click();
    await ctx.save();
    expect(ctx.saved().pivot.pivot).toMatchObject({ rows: { source: "statusTag" }, cols: { source: "statusTag" },
      measure: { agg: "sum", source, fieldKey: "computed" } });
    await page.reload();
    const reopened = await ctx.edit();
    await expect(reopened.getByRole("combobox").filter({ hasText: /^Теги статусов$/ })).toHaveCount(2);
    await expect(reopened.getByRole("combobox").filter({ hasText: source === "page" ? /Формула страницы/ : /^Формула сущности$/ })).toBeVisible();
  });
}

test("notes aggregate source offers configured formula and persists it", async ({ page }) => {
  const ctx = await fixture(page, { widgetType: "notes", notes: { kind: "table", cols: 1, cells: [[{
    kind: "dynamic", sources: [{ key: "s1", sourceKind: "metric", entityId, aggregation: "sum", fieldKey: "price" }],
  }]] } });
  const dialog = await ctx.edit();
  await dialog.getByRole("button", { name: "{s1}", exact: true }).click();
  const cell = page.getByRole("dialog").last();
  await cell.getByRole("combobox").filter({ hasText: /^Цена$/ }).click();
  await expect(page.getByRole("option", { name: "Комментарий", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Формула сущности", exact: true }).click();
  await cell.getByRole("button", { name: "Сохранить", exact: true }).click();
  await ctx.save();
  expect(ctx.saved().notes.cells[0][0].sources[0]).toMatchObject({ aggregation: "sum", fieldKey: "computed" });
});

for (const widgetType of ["metric", "notes"]) {
  test(`related formula SUM uses aggregate-specific options (${widgetType})`, async ({ page }) => {
    const metric = { key: "s1", sourceKind: "metric", source: "entity", entityId, aggregation: "sum", relationId: 15, fieldKey: "price" };
    const ctx = await fixture(page, widgetType === "metric"
      ? { widgetType, metrics: [metric] }
      : { widgetType, notes: { kind: "table", cols: 1, cells: [[{ kind: "dynamic", sources: [metric] }]] } });
    let dialog = await ctx.edit();
    if (widgetType === "notes") {
      await dialog.getByRole("button", { name: "{s1}", exact: true }).click();
      dialog = page.getByRole("dialog").last();
    }
    await dialog.getByRole("combobox").filter({ hasText: /^Цена связи$/ }).click();
    await expect(page.getByRole("option", { name: "Пустая формула", exact: true })).toHaveCount(0);
    // This option exists only when the request explicitly opted into aggregate metadata.
    await page.getByRole("option", { name: "Формула один раз", exact: true }).click();
    if (widgetType === "notes") await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await ctx.save();
    const source = widgetType === "metric" ? ctx.saved().metrics[0] : ctx.saved().notes.cells[0][0].sources[0];
    expect(source).toMatchObject({ aggregation: "sum", relationId: 15, fieldKey: "once" });
  });
}

for (const surface of ["page", "pageLocal", "view", "default"]) {
  test(`shared pivot editor saves formula sums and tag dimension (${surface})`, async ({ page }) => {
    const pivot = { rows: { source: "status" }, measure: { agg: "sum", source: surface === "pageLocal" ? "page" : "entity", fieldKey: "price" } };
    let entity: any = { id: entityId, entityKey: "orders", nameJson: { ru: "Заказы" }, isActive: true, pivotEnabled: true, defaultPivotJson: pivot };
    let adminPage: any = { id: pageId, path: "/pivot-fixture", nameJson: { ru: "Сводная" }, isActive: true,
      isPivot: true, pivotEntityId: entityId, pivotConfigJson: { source: "custom", pivot, pageId: surface === "pageLocal" ? pageId + 1 : null } };
    let view: any = { id: 123, entityId, viewKey: "pivot_test", nameJson: { ru: "Вид сводной" }, sortOrder: 0,
      isActive: true, configJson: { viewType: "pivot", pivot } };
    let saved: any;
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-pivot-editors"));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", language: "ru", isActive: true,
        permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
      if (path === "/api/settings") return reply({ defaultLanguage: "ru", currencySymbol: "₪" });
      if (route.request().method() === "PUT" || route.request().method() === "PATCH") {
        saved = route.request().postDataJSON();
        if (path === `/api/pages/${pageId}`) { adminPage = { ...adminPage, ...saved }; return reply(adminPage); }
        if (path === `/api/views/${view.id}`) { view = { ...view, ...saved }; return reply(view); }
        entity = { ...entity, ...saved }; return reply(entity);
      }
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/pages") return reply([adminPage, { id: pageId + 1, path: "/local-fields", nameJson: { ru: "Локальные поля" }, mirrorEntityId: entityId, isActive: true }]);
      if (path.endsWith("/views")) return reply([view]);
      if (path.endsWith("/fields")) return reply([
        { id: 1, entityId, fieldKey: "price", fieldType: "number", nameJson: { ru: "Цена" }, isActive: true, pivotEnabled: true },
        { id: 2, entityId, fieldKey: "computed", fieldType: "function", nameJson: { ru: "Формула сущности" }, isActive: true, pivotEnabled: true, formulaConfigJson: { expression: "{price}*2" } },
      ]);
      return reply([]);
    });
    const open = async () => {
      if (surface === "page" || surface === "pageLocal") {
        await page.goto("/admin/pages");
        await page.getByRole("row").filter({ hasText: "Сводная" }).getByRole("button").filter({ has: page.locator("svg.lucide-pencil") }).click();
      } else {
        await page.goto(`/admin/entities/${entityId}/views`);
        if (surface === "view") {
          await page.getByRole("row").filter({ hasText: "Вид сводной" }).getByRole("button").filter({ has: page.locator("svg.lucide-pencil") }).click();
        } else {
          await page.getByRole("button", { name: "Настроить", exact: true }).click();
        }
      }
      return page.getByRole("dialog");
    };
    const dialog = await open();
    await dialog.getByRole("combobox").filter({ hasText: /^Статус записи$/ }).first().click();
    await page.getByRole("option", { name: "Теги статусов", exact: true }).click();
    await dialog.getByRole("combobox").filter({ hasText: surface === "pageLocal" ? /^Цена.*поле страницы/ : /^Цена$/ }).click();
    await page.getByRole("option", { name: surface === "pageLocal" ? /Формула сущности.*поле страницы/ : "Формула сущности", exact: surface !== "pageLocal" }).click();
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const result = surface === "page" || surface === "pageLocal" ? saved.pivotConfigJson.pivot : surface === "view" ? saved.configJson.pivot : saved.defaultPivotJson;
    expect(result).toMatchObject({ rows: { source: "statusTag" }, measure: { agg: "sum", fieldKey: "computed" } });
    const reopened = await open();
    await expect(reopened.getByRole("combobox").filter({ hasText: /^Теги статусов$/ })).toBeVisible();
    await expect(reopened.getByRole("combobox").filter({ hasText: surface === "pageLocal" ? /Формула сущности.*поле страницы/ : /^Формула сущности$/ })).toBeVisible();
  });
}

for (const entityKey of ["projects", "orders"]) {
  test(`pivot formula1 opt-in persists and only enables SUM (${entityKey})`, async ({ page }) => {
    const formulaLabel = "formula1";
    const pivot = { rows: { source: "status" }, measure: { agg: "sum", source: "entity", fieldKey: "price" } };
    let entity: any = { id: entityId, entityKey, nameJson: { ru: entityKey === "projects" ? "Проекты" : "Заказы" },
      isActive: true, pivotEnabled: true, defaultPivotJson: pivot };
    let view: any = { id: 123, entityId, viewKey: "pivot_formula", nameJson: { ru: "Вид сводной" },
      sortOrder: 0, isActive: true, configJson: { viewType: "pivot", pivot } };
    let fields: any[] = [
      { id: 1, fieldKey: "price", fieldType: "number", nameJson: { ru: "Цена" }, pivotEnabled: true },
      { id: 2, fieldKey: "formula1", fieldType: "function", nameJson: { ru: formulaLabel }, pivotEnabled: false,
        formulaConfigJson: { expression: "{price}*2", groupResult: { enabled: true, fields: [
          { scope: "entity", fieldKey: "project" }, { scope: "entity", fieldKey: "order" },
        ] } } },
      { id: 3, fieldKey: "blank", fieldType: "function", nameJson: { ru: "Пустая формула" }, pivotEnabled: false,
        formulaConfigJson: { expression: "   " } },
      { id: 4, fieldKey: "project", fieldType: "text", nameJson: { ru: "Проект" }, pivotEnabled: true },
      { id: 5, fieldKey: "order", fieldType: "text", nameJson: { ru: "Заказ" }, pivotEnabled: true },
    ].map(f => ({ ...f, entityId, isActive: true, sortOrder: f.id, permissionsJson: {} }));
    const fieldWrites: unknown[] = [];
    const unexpectedWrites: string[] = [];
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-pivot-formula-opt-in"));
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (request.method() === "PUT") {
        const data = request.postDataJSON();
        if (path === "/api/fields/2") {
          fieldWrites.push(data);
          fields = fields.map(f => f.id === 2 ? { ...f, ...data } : f);
          return reply(fields.find(f => f.id === 2));
        }
        if (path === `/api/views/${view.id}`) { view = { ...view, ...data }; return reply(view); }
        if (path === `/api/entities/${entityId}`) { entity = { ...entity, ...data }; return reply(entity); }
      }
      if (!["GET", "HEAD"].includes(request.method())) {
        unexpectedWrites.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Unexpected mocked mutation" }) });
      }
      if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", language: "ru",
        isActive: true, permissions: { superAdmin: true, pageIds: [], admin: {}, records: {} } });
      if (path === "/api/settings") return reply({ defaultLanguage: "ru", currencySymbol: "₪" });
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === `/api/entities/${entityId}/fields`) return reply(fields);
      if (path === `/api/entities/${entityId}/views`) return reply([view]);
      if (path.includes("/collaboration/")) return route.abort();
      return reply([]);
    });
    const open = async (surface: "view" | "default") => {
      if (surface === "view") {
        await page.getByRole("row").filter({ hasText: "Вид сводной" }).getByRole("button")
          .filter({ has: page.locator("svg.lucide-pencil") }).click();
      } else {
        await page.getByRole("button", { name: "Настроить", exact: true }).click();
      }
      return page.getByRole("dialog");
    };
    await page.goto(`/admin/entities/${entityId}/views`);
    const chip = page.getByRole("button", { name: formulaLabel, exact: true });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Пустая формула", exact: true })).toHaveCount(0);
    // Newly configured but unopted formulas must not already be offered for SUM.
    const unopted = await open("view");
    await unopted.getByRole("combobox").filter({ hasText: /^Цена$/ }).click();
    await expect(page.getByRole("option", { name: formulaLabel, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(fieldWrites).toEqual([{ pivotEnabled: true }]);
    await page.reload();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    for (const surface of ["view", "default"] as const) {
      const dialog = await open(surface);
      await dialog.getByRole("combobox").filter({ hasText: /^Статус записи$/ }).first().click();
      await expect(page.getByRole("option", { name: formulaLabel, exact: true })).toHaveCount(0);
      await expect(page.getByRole("option", { name: "Проект", exact: true })).toBeVisible();
      await expect(page.getByRole("option", { name: "Заказ", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await dialog.getByRole("combobox").filter({ hasText: /^Цена$/ }).click();
      await expect(page.getByRole("option", { name: "Пустая формула", exact: true })).toHaveCount(0);
      await page.getByRole("option", { name: formulaLabel, exact: true }).click();
      await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const savedPivot = surface === "view" ? view.configJson.pivot : entity.defaultPivotJson;
      expect(savedPivot.measure).toMatchObject({ agg: "sum", source: "entity", fieldKey: "formula1" });
      await page.reload();
      const reopened = await open(surface);
      await expect(reopened.getByRole("combobox").filter({ hasText: /^formula1$/ })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(fieldWrites).toEqual([{ pivotEnabled: true }, { pivotEnabled: false }]);
    await page.reload();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    for (const surface of ["view", "default"] as const) {
      const dialog = await open(surface);
      await dialog.getByRole("combobox").last().click();
      await expect(page.getByRole("option", { name: "Цена", exact: true })).toBeVisible();
      await expect(page.getByRole("option", { name: formulaLabel, exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }
    expect(unexpectedWrites).toEqual([]);
  });
}