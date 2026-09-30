import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

// Entire API is intercepted: this regression never reads or writes the shared database.
const entityId = 987654;
const tags = [
  { id: 81, nameJson: { en: "Urgent" }, color: "#b91c1c", applicableTo: ["statuses"], sortOrder: 0, isActive: true },
  { id: 82, nameJson: { en: "Review" }, color: "#1d4ed8", applicableTo: ["statuses"], sortOrder: 1, isActive: true },
  { id: 83, nameJson: { en: "Pale label" }, color: "#FFE599", applicableTo: ["statuses"], sortOrder: 2, isActive: true },
];
const entity = {
  id: entityId, entityKey: "status_display_browser_fixture", nameJson: { en: "Status display fixture" },
  icon: "table", isActive: true, allowNoStatus: true, statusNameJson: { en: "Status" },
  statusManualEditPolicy: "allowed", statusManualEditUserIds: [], defaultPageSize: 50,
  pivotEnabled: false, sortOrder: 0,
};
type MockStatus = {
  id: number; entityId: number; statusKey: string; nameJson: { en: string };
  color: string; isDefault: boolean; isFinal: boolean; isArchiveTrigger: boolean;
  archiveAfterDays: number; isActive: boolean; sortOrder: number;
  tagIds: number[]; showTags: boolean; primaryTagId: number | null;
};
const makeStatus = (id: number, name: string, tagIds: number[]): MockStatus => ({
  id, entityId, statusKey: `status_${id}`, nameJson: { en: name }, color: "#2563eb",
  isDefault: id === 1, isFinal: false, isArchiveTrigger: false, archiveAfterDays: 0,
  isActive: true, sortOrder: id, tagIds, showTags: true, primaryTagId: null,
});

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApi(page: Page, readonly = false, language: "en" | "he" = "en") {
  const statuses = [makeStatus(1, "Tagged status", [81, 82]), makeStatus(2, "Untagged status", [])];
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const unknown: string[] = [];
  await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-status-display"));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const respond = (value: unknown, status?: number) => json(route, value, status);
    if (method === "GET" && path === "/api/auth/me") return respond({
      id: 1, email: "intercepted@example.test", firstName: "Browser", lastName: "Fixture",
      roleId: 1, roleIds: [1], language, direction: language === "he" ? "rtl" : "ltr", isActive: true,
      permissions: {
        superAdmin: !readonly, dashboard: false, pageIds: [],
        admin: { entities: !readonly, tags: !readonly },
        records: { [entityId]: { view: true, create: !readonly, update: true, delete: false, scope: "all" } },
      },
    });
    if (method === "GET" && path === "/api/pages") return respond([]);
    if (method === "GET" && path === "/api/entities") return respond([{ ...entity, statusManualEditPolicy: readonly ? "disabled_all" : "allowed" }]);
    if (method === "GET" && path === `/api/entities/${entityId}`) return respond({ ...entity, statusManualEditPolicy: readonly ? "disabled_all" : "allowed" });
    if (method === "GET" && path === "/api/tags") return respond(tags);
    if (method === "GET" && path === `/api/entities/${entityId}/statuses`) {
      return respond(statuses.map(s => ({
        ...s, displayTags: !s.showTags ? [] : tags.filter(t => s.tagIds.includes(t.id) && (s.primaryTagId == null || t.id === s.primaryTagId)),
      })));
    }
    if (method === "POST" && path === `/api/entities/${entityId}/statuses`) {
      const body = request.postDataJSON() as Partial<MockStatus>;
      writes.push({ method, path, body });
      const created = { ...makeStatus(3, "Created status", []), ...body, id: 3 };
      statuses.push(created);
      return respond(created, 201);
    }
    const statusId = path.match(/^\/api\/statuses\/(\d+)$/);
    if (method === "PUT" && statusId) {
      const body = request.postDataJSON() as Partial<MockStatus>;
      writes.push({ method, path, body });
      const index = statuses.findIndex(s => s.id === Number(statusId[1]));
      statuses[index] = { ...statuses[index], ...body };
      return respond(statuses[index]);
    }
    if (method === "GET" && path === `/api/entities/${entityId}/fields`) return respond([{
      id: 1, entityId, fieldKey: "title", nameJson: { en: "Title" }, fieldType: "text",
      permissionsJson: { "1": "view" }, optionsJson: [], sortOrder: 0, isActive: true,
      showInTable: true, isFilterable: true, isRequired: false,
    }]);
    if (method === "POST" && path === `/api/entities/${entityId}/records/query`) return respond({
      data: [1, 2].map((id) => ({
        id, entityId, statusId: id, valuesJson: { title: id === 1 ? "Tagged record" : "Untagged record" },
        version: 1, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
      })),
      total: 2, numericTotals: {},
    });
    if (method === "POST" && path === `/api/entities/${entityId}/related-values`) {
      return respond({ columns: [], values: [] });
    }
    if (method === "GET" && [
      `/api/entities/${entityId}/main-views`, `/api/entities/${entityId}/transitions`,
      `/api/entities/${entityId}/relations`, `/api/entities/${entityId}/custom-filters`,
      "/api/column-groups", "/api/users/options", "/api/roles", "/api/translations",
      "/api/admin/operational-alerts", "/api/google-drive/folders", "/api/local-folders",
    ].includes(path)) return respond([]);
    if (method === "GET" && path === "/api/settings") return respond({
      defaultLanguage: "en", currencySymbol: "$", timeZone: "UTC", tableStyle: "plain",
      workingDays: [1, 2, 3, 4, 5], firstDayOfWeek: 1,
    });
    unknown.push(`${method} ${path}`);
    return respond({ error: `Unhandled intercepted endpoint: ${method} ${path}` }, 404);
  });
  return { statuses, writes, unknown };
}

async function expectStackedStatus(container: Locator, name: string, labels: string) {
  const tag = container.locator(`span[title="${labels}"]`).first();
  const status = container.locator(`span[title="${name}"]`).first();
  await expect(tag).toBeVisible();
  await expect(status).toBeVisible();
  const tagBox = await tag.boundingBox();
  const statusBox = await status.boundingBox();
  expect(tagBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(statusBox!.y).toBeGreaterThanOrEqual(tagBox!.y + tagBox!.height - 1);
  expect(await tag.evaluate(el => getComputedStyle(el).lineHeight)).toBe("12px");
  expect(await status.evaluate(el => getComputedStyle(el).lineHeight)).toBe("16px");
}

test("status tag display all, preferred, and hidden persists across edits and reloads in the browser", async ({ page }) => {
  const api = await mockApi(page);
  const statusPath = `/admin/entities/${entityId}/statuses`;
  const recordPath = `/admin/entities/${entityId}/records`;
  await page.goto(statusPath);
  const row = page.locator("tbody tr").filter({ has: page.getByText("Tagged status", { exact: true }) });
  await expect(row).toBeVisible();
  const open = async () => {
    await row.getByRole("button").nth(2).click();
    return page.getByRole("dialog");
  };
  const save = async () => {
    await page.getByRole("dialog").getByRole("button", { name: /Save|Сохранить|Create|Создать/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  let dialog = await open();
  await expect(dialog.getByRole("switch", { name: /Show tags|Показывать теги/ })).toBeChecked();
  await expect(dialog.locator("#status-primary-tag")).toContainText(/All tags|Все теги/);
  await save();
  await page.getByRole("button", { name: /Add status|Добавить статус/ }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "EN", exact: true }).click();
  await dialog.getByPlaceholder(/English\)/).fill("Created status");
  await dialog.getByRole("button", { name: "Urgent", exact: true }).click();
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await dialog.locator("#status-primary-tag").click();
  await page.getByRole("option", { name: "Urgent" }).click();
  await save();
  expect(api.writes.at(-1)?.body).toMatchObject({ showTags: true, primaryTagId: 81, tagIds: [81, 82] });
  await page.reload();
  const created = page.locator("tbody tr").filter({ has: page.getByText("Created status", { exact: true }) });
  await created.getByRole("button").nth(2).click();
  await expect(page.getByRole("dialog").locator("#status-primary-tag")).toContainText("Urgent");
  await page.getByRole("dialog").getByRole("button", { name: /Cancel|Отмена/ }).click();
  await page.goto(recordPath);
  const tagged = page.getByTestId("record-cell").filter({ has: page.getByText("Tagged status", { exact: true }) }).first();
  await expect(tagged).toContainText("Urgent");
  await expect(tagged).toContainText("Review");
  await expectStackedStatus(tagged, "Tagged status", "Urgent, Review");
  const untagged = page.getByTestId("record-cell").filter({ has: page.getByText("Untagged status", { exact: true }) }).first();
  await expect(untagged).not.toContainText("Urgent");
  // Table layout can equalize row heights; verify the stacked lines themselves instead.
  await expect(untagged.locator('span[title="Untagged status"]')).toBeVisible();
  await page.screenshot({ path: "/tmp/status-tag-record-cells.jpg" });
  await page.locator('[data-testid="record-edit-button"][data-record-id="1"]').click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog).toContainText("Urgent");
  await expect(editDialog).toContainText("Review");
  await editDialog.getByRole("combobox").last().click();
   await expect(page.getByRole("option", { name: /Urgent.*Review.*Tagged status/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await editDialog.getByRole("button", { name: /Cancel|Отмена/ }).click();

  await page.goto(statusPath);
  dialog = await open();
  await dialog.locator("#status-primary-tag").click();
  await page.getByRole("option", { name: "Review" }).click();
  await save();
  expect(api.writes.at(-1)?.body).toMatchObject({ showTags: true, primaryTagId: 82, tagIds: [81, 82] });
  await page.reload();
  dialog = await open();
  await expect(dialog.locator("#status-primary-tag")).toContainText("Review");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({ path: "/tmp/status-tag-settings.jpg" });
  await save();
  await page.goto(recordPath);
  const taggedStatusCell = page.locator('[data-testid="record-cell"][data-record-id="1"][data-field-key="__status__"]');
  await expect(taggedStatusCell).toContainText("Review");
  await expect(taggedStatusCell).not.toContainText("Urgent");
  await expectStackedStatus(taggedStatusCell, "Tagged status", "Review");

  await page.goto(statusPath);
  dialog = await open();
  await dialog.getByRole("switch", { name: /Show tags|Показывать теги/ }).click();
  await save();
  expect(api.writes.at(-1)?.body).toMatchObject({ showTags: false, primaryTagId: 82 });
  await page.reload();
  dialog = await open();
  await expect(dialog.getByRole("switch", { name: /Show tags|Показывать теги/ })).not.toBeChecked();
  await expect(dialog.locator("#status-primary-tag")).toHaveCount(0);
  await save();
  await page.goto(recordPath);
  await expect(taggedStatusCell).not.toContainText("Review");
  await expect(taggedStatusCell).not.toContainText("Urgent");
  expect(api.unknown).toEqual([]);
});

test("read-only record status retains the preferred tag without exposing an editor", async ({ page }) => {
  const api = await mockApi(page, true);
  api.statuses[0].primaryTagId = 82;
  await page.goto(`/admin/entities/${entityId}/records`);
  const statusCell = page.locator('[data-testid="record-cell"][data-record-id="1"][data-field-key="__status__"]');
  await expect(statusCell).toContainText("Review");
  await expect(statusCell).not.toContainText("Urgent");
  await page.locator('[data-testid="record-edit-button"][data-record-id="1"]').click();
  await expect(page.getByTestId("text-status-readonly")).toContainText("Review");
  await expect(page.getByTestId("text-status-readonly")).not.toContainText("Urgent");
  expect(api.unknown).toEqual([]);
});

test("RTL record cells stack tags above the status name", async ({ page }) => {
  const api = await mockApi(page, false, "he");
  await page.goto(`/admin/entities/${entityId}/records`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const tagged = page.locator('[data-testid="record-cell"][data-record-id="1"][data-field-key="__status__"]');
  const plain = page.locator('[data-testid="record-cell"][data-record-id="2"][data-field-key="__status__"]');
  await expect(tagged).toContainText("Urgent");
  await expect(tagged).toContainText("Review");
  await expect(plain).not.toContainText("Urgent");
  await expectStackedStatus(tagged, "Tagged status", "Urgent, Review");
  await expect(plain.locator('span[title="Untagged status"]')).toBeVisible();
  expect(api.unknown).toEqual([]);
});

test("narrow status cell wraps a long Russian status beneath a neutral pale tag in RTL", async ({ page }) => {
  const api = await mockApi(page, true, "he");
  const name = "Очень длинный статус для проверки переноса полного названия";
  api.statuses[0].nameJson.en = name;
  api.statuses[0].tagIds = [83];
  await page.goto(`/admin/entities/${entityId}/records`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const cell = page.locator('[data-testid="record-cell"][data-record-id="1"][data-field-key="__status__"]');
  await expect(cell).toBeVisible();
  await cell.evaluate(el => {
    const td = el.closest("td")!;
    td.style.width = "140px";
    td.style.minWidth = "140px";
    td.style.maxWidth = "140px";
    td.style.boxSizing = "border-box";
  });
  await expectStackedStatus(cell, name, "Pale label");
  const metrics = await cell.evaluate((el, statusName) => {
    const td = el.closest("td")!;
    const tag = el.querySelector<HTMLElement>('span[title="Pale label"]')!;
    const nameEl = Array.from(el.querySelectorAll<HTMLElement>("span[title]")).find(node => node.title === statusName)!;
    const tagStyle = getComputedStyle(tag);
    const nameStyle = getComputedStyle(nameEl);
    return {
      width: td.getBoundingClientRect().width,
      tagColor: tagStyle.color,
      tagBackground: tagStyle.backgroundColor,
      direction: getComputedStyle(nameEl).direction,
      textAlign: nameStyle.textAlign,
      nameHeight: nameEl.getBoundingClientRect().height,
      nameScrollHeight: nameEl.scrollHeight,
      nameClientHeight: nameEl.clientHeight,
      overflow: nameStyle.textOverflow,
      whiteSpace: nameStyle.whiteSpace,
    };
  }, name);
  expect(metrics.width).toBeGreaterThanOrEqual(139);
  expect(metrics.width).toBeLessThanOrEqual(141);
  expect(metrics.nameHeight).toBeGreaterThan(16);
  expect(metrics.nameScrollHeight).toBeLessThanOrEqual(metrics.nameClientHeight + 1);
  expect(metrics.overflow).not.toBe("ellipsis");
  expect(metrics.whiteSpace).not.toBe("nowrap");
  expect(metrics.tagColor).toMatch(/^(oklch\(0\.446 0\.043 257\.281\)|rgb\(71, 85, 105\))$/);
  expect(metrics.tagBackground).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.direction).toBe("rtl");
  expect(metrics.textAlign).toBe("start");
  await page.screenshot({ path: "/tmp/status-tags-stacked.png" });
  await page.locator('[data-testid="record-edit-button"][data-record-id="1"]').click();
  const readonly = page.getByTestId("text-status-readonly");
  await expectStackedStatus(readonly, name, "Pale label");
  expect(await readonly.evaluate(el => el.scrollHeight)).toBeLessThanOrEqual(await readonly.evaluate(el => el.clientHeight) + 1);
  expect(api.unknown).toEqual([]);
});