import { expect, test } from "@playwright/test";

for (const scenario of [
  { admin: false, rtl: false, hideStatus: false, create: true },
  { admin: false, rtl: true, hideStatus: true, create: true },
  { admin: true, rtl: false, hideStatus: false, create: true },
  { admin: false, rtl: false, hideStatus: false, create: false },
]) {
  test(`inline creation controls are independent of actions visibility ${JSON.stringify(scenario)}`, async ({ page }) => {
    const entityId = 987654, pageId = 987655;
    const errors: string[] = [];
    const unexpectedWrites: string[] = [];
    const creates: Record<string, unknown>[] = [];
    const pageWrites: Record<string, unknown>[] = [];
    let releaseCreate!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const entity = { id: entityId, pageId, entityKey: "inline_create_fixture", nameJson: { en: "Items" }, isActive: true, allowNoStatus: true, defaultPageSize: 50 };
    const records = [{
      id: 10, entityId, statusId: 1, valuesJson: { field0: "Existing item" },
      version: 1, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
    }];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ entityId, pageId }) => {
      localStorage.setItem("erp_token", "intercepted-inline-create");
      localStorage.setItem(`erp:colwidths:${entityId}:${pageId}`, JSON.stringify(Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`f:${i + 1}`, 180]),
      )));
    }, { entityId, pageId });
    // Every request is intercepted; the fixture never accesses the real API/DB.
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({
        id: scenario.admin ? 1 : 2, email: "inline@example.test", firstName: "Inline",
        roleId: scenario.admin ? 1 : 2, roleIds: [scenario.admin ? 1 : 2],
        language: scenario.rtl ? "he" : "en", direction: scenario.rtl ? "rtl" : "ltr", isActive: true,
        permissions: { superAdmin: scenario.admin, pageIds: [pageId], admin: {}, records: {
          [entityId]: { view: true, create: scenario.create, update: false, delete: false, scope: "all", hideStatusColumn: scenario.hideStatus, hideActionsColumn: !scenario.admin },
        } },
      });
      if (path === "/api/pages") return reply([{ id: pageId, path: "/inline-create-fixture", nameJson: { en: "Items" }, isActive: true }]);
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === "/api/settings") return reply({ defaultLanguage: "en", timeZone: "UTC" });
      if (path === `/api/entities/${entityId}/fields`) return reply(Array.from({ length: 12 }, (_, i) => ({
        id: i + 1, entityId, fieldKey: `field${i}`, nameJson: { en: `Item field ${i}` },
        fieldType: "text", sortOrder: i, isActive: true, showInTable: true, permissionsJson: {},
      })));
      if (path === `/api/pages/${pageId}/fields`) return reply([{
        id: 101, pageId, fieldKey: "quantity", nameJson: { en: "Page quantity" }, fieldType: "number",
        sortOrder: 0, isActive: true, showInTable: true, permissionsJson: {}, optionsJson: [],
      }]);
      if (path.endsWith("/statuses")) return reply([{ id: 1, entityId, nameJson: { en: "New" }, color: "#00aa00", sortOrder: 0 }]);
      if (path.endsWith("/views")) return reply([{ id: 99, entityId, pageId, nameJson: { en: "All" }, isDefault: true, sortOrder: 0, configJson: {} }]);
      if (path === `/api/entities/${entityId}/records/query`) return reply({ data: records, total: records.length, numericTotals: {} });
      if (path === `/api/entities/${entityId}/records` && request.method() === "POST") {
        const body = request.postDataJSON();
        creates.push(body);
        await createGate;
        const created = { ...records[0], id: 11, valuesJson: body.valuesJson };
        records.push(created);
        return reply(created);
      }
      if (path === `/api/pages/${pageId}/records/11/values` && request.method() === "PUT") {
        const body = request.postDataJSON();
        pageWrites.push(body);
        return reply({ pageId, recordId: 11, valuesJson: body.valuesJson, version: 1 });
      }
      if (path.endsWith("/record-values/query")) return reply(records.map(record => ({
        recordId: record.id, valuesJson: record.id === 11 ? { quantity: 7 } : {}, version: 1, fieldVersions: {},
      })));
      if (path.includes("/collaboration/")) return route.abort();
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      if (request.method() === "PUT" || request.method() === "DELETE" ||
          (request.method() === "POST" && !path.endsWith("/filter-values"))) {
        unexpectedWrites.push(`${request.method()} ${path}`);
      }
      return reply([]);
    });
    await page.goto("/inline-create-fixture");
    await expect(page.getByRole("columnheader", { name: /Item field 0/ })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", scenario.rtl ? "rtl" : "ltr");
    const add = page.getByRole("button", { name: /Добавить строку|Add row|הוסף שורה/ }).first();
    const draft = page.getByTestId("row-inline-create-draft");
    const toolbar = page.getByTestId("row-inline-create-controls");
    const save = page.getByTestId("button-save-inline-row");
    const cancel = page.getByTestId("button-cancel-inline-row");
    if (!scenario.create) {
      await expect(add).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Добавить запись|Add record/ })).toHaveCount(0);
      await expect(toolbar).toHaveCount(0);
      expect(creates).toEqual([]);
      expect(errors).toEqual([]);
      return;
    }
    await expect(add).toBeEnabled();
    await add.click();
    await expect(toolbar).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(cancel).toBeEnabled();
    await expect(save).not.toHaveText("");
    await expect(cancel).not.toHaveText("");
    await expect(draft.getByTestId("button-save-inline-row")).toHaveCount(0);
    const columns = await page.locator("tr.erp-main-header th").count();
    expect(await draft.locator("td").count()).toBe(columns);
    expect(await toolbar.locator("td").evaluate(td => (td as HTMLTableCellElement).colSpan)).toBe(columns);
    await expect(page.getByRole("columnheader", { name: /Действия|Actions|פעולות/ })).toHaveCount(scenario.admin ? 1 : 0);
    await expect(save).toHaveCount(1);
    await expect(cancel).toHaveCount(1);

    const scroll = page.locator("div.overflow-auto").filter({ has: page.locator("table") }).last();
    expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    for (const atEnd of [true, false]) {
      await scroll.evaluate((el, { rtl, atEnd }) => { el.scrollLeft = atEnd ? (rtl ? -el.scrollWidth : el.scrollWidth) : 0; }, { rtl: scenario.rtl, atEnd });
      for (const button of [save, cancel]) {
        const buttonBox = (await button.boundingBox())!;
        const scrollBox = (await scroll.boundingBox())!;
        expect(buttonBox.x).toBeGreaterThanOrEqual(scrollBox.x - 1);
        expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 1);
      }
      if (atEnd) await page.screenshot({ path: test.info().outputPath("inline-create-toolbar.png") });
    }
    await draft.locator("input").first().fill("Cancelled draft");
    await cancel.click();
    await expect(toolbar).toHaveCount(0);
    await expect(draft).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /Действия|Actions|פעולות/ })).toHaveCount(scenario.admin ? 1 : 0);
    expect(creates).toEqual([]);
    await add.click();
    await draft.locator("input").first().fill("Created inline");
    await draft.locator("input").last().fill("7");
    await save.click();
    await expect.poll(() => creates.length).toBe(1);
    await expect(save).toBeDisabled();
    await expect(cancel).toBeDisabled();
    releaseCreate();
    await expect(page.locator('[data-testid="record-cell"][data-record-id="11"][data-field-key="field0"]')).toHaveText("Created inline");
    await expect(toolbar).toHaveCount(0);
    await expect(draft).toHaveCount(0);
    await expect.poll(() => pageWrites.length).toBe(1);
    expect(creates[0]).toMatchObject({ valuesJson: { field0: "Created inline" } });
    expect(pageWrites[0]).toMatchObject({ valuesJson: { quantity: 7 } });
    expect(unexpectedWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
}