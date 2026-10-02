import { expect, test, type Page } from "@playwright/test";

test("mirror pins survive Russian → Hebrew; switch stays inside its RTL track", async ({ page }) => {
  const entityId = 987640, pageId = 987641;
  let language = "ru";
  let mirrorPinnedJson: Record<string, boolean> = {};
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const entity = { id: entityId, pageId: 987642, entityKey: "rtl_fixture", nameJson: { ru: "Источник" }, isActive: true, allowNoStatus: true };
  const pageData = () => ({ id: pageId, path: "/rtl-pinning-fixture", nameJson: { ru: "Основной" }, isActive: true, mirrorEntityId: entityId, mirrorPinnedJson });
  await page.addInitScript(({ entityId, pageId }) => {
    localStorage.setItem("erp_token", "intercepted-rtl-fixture");
    localStorage.setItem(`erp:colwidths:${entityId}:${pageId}`, JSON.stringify(
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f:${i + 1}`, 180])),
    ));
  }, { entityId, pageId });
  // Isolated fixture: intercept ALL API requests, including settings writes.
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/me") return reply({ id: 1, firstName: "RTL Tester", email: "rtl@example.test",
      roleId: 1, roleIds: [1], language, direction: language === "he" ? "rtl" : "ltr", isActive: true,
      permissions: { superAdmin: true, pageIds: [pageId], admin: {}, records: {} } });
    if (path === "/api/pages") return reply([pageData()]);
    if (path === `/api/pages/${pageId}`) {
      if (req.method() === "PUT") mirrorPinnedJson = req.postDataJSON().mirrorPinnedJson ?? {};
      return reply(pageData());
    }
    if (path === "/api/entities") return reply([entity]);
    if (path === `/api/entities/${entityId}`) return reply(entity);
    if (path === "/api/settings") return reply({ defaultLanguage: "ru", timeZone: "UTC" });
    if (path === `/api/entities/${entityId}/fields`) return reply(Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, entityId, fieldKey: `field${i}`, nameJson: { ru: i === 0 ? "Управляющий проектами" : `Поле ${i}` },
      fieldType: "text", sortOrder: i, isActive: true, showInTable: true, isPinned: i === 1, permissionsJson: {},
    })));
    if (path.endsWith("/records/query")) return reply({ data: [1, 2].map(id => ({
      id, entityId, statusId: null, valuesJson: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`field${i}`, `Value ${id}/${i}`])),
      version: 1, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
    })), total: 2, numericTotals: {} });
    if (path.includes("/collaboration/")) return route.abort();
    if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
    return reply([]);
  });
  await page.goto("/rtl-pinning-fixture");
  const setup = page.getByRole("button", { name: "Режим настройки", exact: true });
  const openColumn = async () => {
    await setup.click();
    await page.getByTitle("Настроить колонку на этой странице", { exact: true }).first().click();
  };
  const checkThumb = async () => {
    const toggle = page.getByRole("dialog").getByRole("switch");
    await expect.poll(async () => toggle.evaluate(el => {
      const track = el.getBoundingClientRect(), thumb = el.firstElementChild!.getBoundingClientRect();
      return thumb.left >= track.left + 1 && thumb.right <= track.right - 1;
    })).toBe(true);
  };
  await openColumn();
  await page.getByRole("switch").click();
  await checkThumb();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => mirrorPinnedJson.field0 ?? mirrorPinnedJson["e:field0"]).toBe(true);
  await setup.click();
  await verifyFrozenColumns(page, false);

  // Use the real language menu without remounting the table.
  language = "he";
  await page.getByRole("button", { name: /RTL Tester/ }).click();
  await page.getByRole("menuitem", { name: /עברית/ }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await verifyFrozenColumns(page, true);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await verifyFrozenColumns(page, true);
  const firstCell = page.locator('[data-testid="record-cell"][data-record-id="1"][data-field-key="field0"]');
  expect(await firstCell.evaluate(el => getComputedStyle(el).insetInlineStart)).toBe("40px");
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await openColumn();
  await expect(page.getByRole("switch")).toBeChecked();
  await checkThumb();
  await page.getByRole("switch").click();
  await checkThumb();
  await page.getByRole("switch").focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("switch")).toBeChecked();
  await checkThumb();
  await page.screenshot({ path: test.info().outputPath("rtl-pin-switch.png") });
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await setup.click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await verifyFrozenColumns(page, true);
  expect(errors).toEqual([]);
});

async function verifyFrozenColumns(page: Page, rtl: boolean) {
  const cells = [0, 1].map(i => page.locator(`[data-testid="record-cell"][data-record-id="1"][data-field-key="field${i}"]`));
  await expect(cells[0]).toBeVisible();
  const scroll = async (amount: number) => cells[0].evaluate((cell, value) => {
    let parent = cell.parentElement!;
    while (parent && !(parent.scrollWidth > parent.clientWidth && /auto|scroll/.test(getComputedStyle(parent).overflowX))) parent = parent.parentElement!;
    if (!parent) throw new Error("No horizontal scroller");
    parent.scrollLeft = value;
  }, rtl ? -amount : amount);
  await scroll(500);
  await expect.poll(() => cells[0].evaluate(el => getComputedStyle(el).position)).toBe("sticky");
  const first = await Promise.all(cells.map(c => c.boundingBox()));
  await scroll(750);
  await expect.poll(async () => {
    const after = await Promise.all(cells.map(c => c.boundingBox()));
    return after.every((box, i) => Math.abs(box!.x - first[i]!.x) < 1);
  }).toBe(true);
  const boxes = await Promise.all(cells.map(c => c.boundingBox()));
  expect(Math.abs(rtl ? boxes[1]!.x + boxes[1]!.width - boxes[0]!.x : boxes[0]!.x + boxes[0]!.width - boxes[1]!.x)).toBeLessThan(2);
  const header = page.locator("tr.erp-main-header th").filter({ hasText: "Управляющий проектами" });
  const headerBox = await header.boundingBox();
  expect(Math.abs(headerBox!.x - boxes[0]!.x)).toBeLessThan(2);
  await expect.poll(() => header.evaluate(el => getComputedStyle(el).position)).toBe("sticky");
}