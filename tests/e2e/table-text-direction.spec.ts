import { expect, test } from "@playwright/test";

for (const scenario of [
  { lang: "ru", app: "rtl", page: null, inherited: "rtl" },
  { lang: "en", app: "rtl", page: "ltr", inherited: "ltr" },
  { lang: "he", app: "ltr", page: "rtl", inherited: "rtl" },
  { lang: "he", app: null, page: null, inherited: "rtl" },
] as const) {
  test(`cell direction priority and translated statuses ${JSON.stringify(scenario)}`, async ({ page }) => {
    const entityId = 987630, pageId = 987631;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-text-direction"));
    const entity = { id: entityId, pageId, entityKey: "direction_test", nameJson: { ru: "Проверка" }, isActive: true, allowNoStatus: true };
    const statuses = [
      { id: 1, nameJson: { ru: "Русский статус" } },
      { id: 2, nameJson: { he: "123 ABC מצב" } },
      { id: 3, nameJson: { ru: "Все переводы", en: "All translations", he: "כל התרגומים" } },
    ].map(status => ({ ...status, entityId, color: "#123456", isActive: true, sortOrder: status.id, displayTags: [] }));
    // Every API read/write is isolated from the real database.
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
      if (path === "/api/auth/me") return reply({ id: 1, firstName: "Direction", language: scenario.lang, direction: scenario.lang === "he" ? "rtl" : "ltr",
        roleId: 1, roleIds: [1], isActive: true, permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
      if (path === "/api/settings") return reply({ textDirection: scenario.app, defaultLanguage: "ru", timeZone: "UTC" });
      if (path === "/api/pages") return reply([{ id: pageId, path: "/text-direction-fixture", nameJson: { ru: "Направление" }, isActive: true, textDirection: scenario.page }]);
      if (path === "/api/entities") return reply([entity]);
      if (path === `/api/entities/${entityId}`) return reply(entity);
      if (path === `/api/entities/${entityId}/statuses`) return reply(statuses);
      if (path === `/api/entities/${entityId}/fields`) return reply([
        { id: 1, fieldKey: "inherited", textDirection: null },
        { id: 2, fieldKey: "forced_ltr", textDirection: "ltr" },
        { id: 3, fieldKey: "forced_rtl", textDirection: "rtl" },
      ].map((field, i) => ({ ...field, entityId, nameJson: { ru: field.fieldKey }, fieldType: "text", isActive: true, showInTable: true, sortOrder: i, permissionsJson: {} })));
      if (path === `/api/pages/${pageId}/fields`) return reply([{
        id: 4, pageId, fieldKey: "page_ltr", nameJson: { ru: "Локальное поле" }, fieldType: "text",
        textDirection: "ltr", isActive: true, showInTable: true, sortOrder: 0,
      }]);
      if (path.endsWith("/records/query")) return reply({ data: statuses.map(status => ({
        id: status.id, entityId, statusId: status.id, valuesJson: { inherited: "Mixed טקסט", forced_ltr: "Mixed טקסט", forced_rtl: "Mixed טקסט" },
        version: 1, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
      })), total: 3, numericTotals: {} });
      if (path.endsWith("/record-values/query")) return reply(statuses.map(s => ({ recordId: s.id, valuesJson: { page_ltr: "Local טקסט" }, version: 1 })));
      if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
      if (path.includes("/collaboration/")) return route.abort();
      return reply([]);
    });
    await page.goto("/text-direction-fixture");
    await expect(page.locator("html")).toHaveAttribute("dir", scenario.lang === "he" ? "rtl" : "ltr");
    for (const recordId of [1, 2, 3]) {
      for (const [key, dir] of [["inherited", scenario.inherited], ["forced_ltr", "ltr"], ["forced_rtl", "rtl"]] as const) {
        const cell = page.locator(`[data-testid="record-cell"][data-record-id="${recordId}"][data-field-key="${key}"]`);
        await expect(cell).toBeVisible();
        await expect.poll(() => cell.evaluate(el => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) if (node.textContent?.includes("Mixed")) return getComputedStyle(node.parentElement!).direction;
          return null;
        })).toBe(dir);
      }
    }
    const body = page.locator("tbody");
    for (const localValue of await body.getByText("Local טקסט", { exact: true }).all()) {
      await expect.poll(() => localValue.evaluate(el => getComputedStyle(el).direction)).toBe("ltr");
    }
    await expect(body.getByText("Local טקסט", { exact: true })).toHaveCount(3);
    await expect(body.getByText("Русский статус", { exact: true }).first().locator("xpath=ancestor::*[@data-status-direction][1]")).toHaveAttribute("dir", "ltr");
    await expect(body.getByText("123 ABC מצב", { exact: true }).first().locator("xpath=ancestor::*[@data-status-direction][1]")).toHaveAttribute("dir", "rtl");
    const allLabel = scenario.lang === "he" ? "כל התרגומים" : scenario.lang === "en" ? "All translations" : "Все переводы";
    await expect(body.getByText(allLabel, { exact: true }).first().locator("xpath=ancestor::*[@data-status-direction][1]")).toHaveAttribute("dir", scenario.lang === "he" ? "rtl" : "ltr");
    // Direction on a shrink-to-fit label is insufficient: its actual position
    // must follow the displayed translation, not the surrounding flex row.
    for (const [label, direction] of [
      ["Русский статус", "ltr"],
      ["123 ABC מצב", "rtl"],
      [allLabel, scenario.lang === "he" ? "rtl" : "ltr"],
    ]) {
      const text = body.getByText(label, { exact: true }).first();
      const alignment = await text.evaluate((el, dir) => {
        const bounds = el.getBoundingClientRect();
        const cell = el.closest("td")!;
        const outer = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return dir === "rtl"
          ? Math.abs(bounds.right - (outer.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)))
          : Math.abs(bounds.left - (outer.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)));
      }, direction);
      expect(alignment, `${label} must align to the ${direction === "rtl" ? "right" : "left"} cell edge`).toBeLessThanOrEqual(2);
    }
    expect(errors).toEqual([]);
  });
}