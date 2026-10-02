import { expect, test, type Page } from "@playwright/test";

const entityId = 987670;
const pageId = 987671;
const boardViewId = 987672;
const fixturePath = "/kanban-fixture";

type Query = {
  statusIds?: number[];
  statusIsNull?: boolean;
  showHiddenStatuses?: boolean;
  viewId?: number;
  pageId?: number;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
};
type FixtureRecord = {
  id: number;
  entityId: number;
  statusId: number | null;
  valuesJson: Record<string, unknown>;
  version: number;
  archivedAt: null;
  createdAt: string;
  updatedAt: string;
};

async function installFixture(page: Page, options: { editable?: boolean; manyCards?: boolean; viewMode?: "single" | "none" | "multiple-no-default"; cardDirection?: "ltr" | "rtl" | null; tintColumns?: boolean } = {}) {
  const queries: Query[] = [];
  const writes: { id: number; body: Record<string, unknown> }[] = [];
  const unexpectedWrites: string[] = [];
  const errors: string[] = [];
  const detailReads: number[] = [];
  const entity = {
    id: entityId, pageId, entityKey: "kanban_fixture", nameJson: { en: "Kanban items" },
    isActive: true, allowNoStatus: true, defaultPageSize: 50,
  };
  const statuses = [
    { id: 1, nameJson: { en: "Ready" }, sortOrder: 0, hideByDefault: false },
    { id: 2, nameJson: { en: "Working" }, sortOrder: 1, hideByDefault: false },
    { id: 3, nameJson: { en: "Hidden done" }, sortOrder: 2, hideByDefault: true },
  ].map(status => ({ ...status, entityId, isActive: true, color: status.id === 2 ? "#f59e0b" : "#2563eb", displayTags: [] }));
  const makeRecord = (id: number, statusId: number | null): FixtureRecord => ({
    id, entityId, statusId,
    valuesJson: { title: `Item ${id}`, summary: `Summary ${id}`, detail: `Full detail ${id}`, empty: "" },
    version: 7, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  });
  // More than one page in two lanes lets pagination prove lane independence.
  const records = [
    makeRecord(10, null), makeRecord(300, 3),
    ...Array.from({ length: options.manyCards ? 180 : 75 }, (_, i) => makeRecord(1000 + i, 1)),
    ...Array.from({ length: 75 }, (_, i) => makeRecord(2000 + i, 2)),
  ];
  let pendingMove: { release: (fail?: boolean) => void } | undefined;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-kanban"));
  // Full-app fixture: every API request is mocked, including all mutations.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path === "/api/auth/me") return reply({
      id: 1, firstName: "Kanban", roleId: 1, roleIds: [1], language: "en", direction: "ltr", isActive: true,
      permissions: { superAdmin: false, pageIds: [pageId], admin: {}, records: {
        [entityId]: { view: true, create: false, update: options.editable === true, delete: false, scope: "all" },
      } },
    });
    if (path === "/api/settings") return reply({ defaultLanguage: "en", timeZone: "UTC" });
    if (path === "/api/pages") return reply([{ id: pageId, path: fixturePath, nameJson: { en: "Kanban items" }, isActive: true }]);
    if (path === "/api/entities") return reply([entity]);
    if (path === `/api/entities/${entityId}`) return reply(entity);
    if (path === `/api/entities/${entityId}/statuses`) return reply(statuses);
    if (path === `/api/entities/${entityId}/fields`) return reply(
      ["title", "summary", "detail", "empty"].map((fieldKey, i) => ({
        id: i + 1, entityId, fieldKey, nameJson: { en: fieldKey === "detail" ? "Full detail" : fieldKey },
        fieldType: "text", isActive: true, showInTable: true, sortOrder: i, permissionsJson: {},
      })),
    );
    if (path === `/api/pages/${pageId}/fields`) return reply([]);
    if (path.endsWith("/views") || path.endsWith("/main-views")) return reply(options.viewMode === "none" ? [] : [
      ...options.viewMode === "single" ? [] : [
      { id: boardViewId - 1, entityId, pageId, nameJson: { en: "Table fixture" }, isDefault: options.viewMode !== "multiple-no-default", sortOrder: 0, configJson: {} }],
      { id: boardViewId, entityId, pageId, nameJson: { en: "Board fixture" }, isDefault: false, sortOrder: 1,
        configJson: { viewType: "kanban", kanban: { titleField: "title", fields: ["summary", "empty"], showLabels: true, hideEmptyFields: true, textDirection: options.cardDirection, tintColumns: options.tintColumns } } },
    ]);
    if (path === `/api/entities/${entityId}/records/query`) {
      const query = request.postDataJSON() as Query;
      queries.push(query);
      const matching = records.filter(record => {
        if (query.statusIsNull && record.statusId !== null) return false;
        if (query.statusIds?.length && !query.statusIds.includes(record.statusId!)) return false;
        if (!query.showHiddenStatuses && record.statusId === 3) return false;
        return true;
      });
      const pageSize = query.pageSize ?? 50;
      const offset = ((query.page ?? 1) - 1) * pageSize;
      return reply({ data: matching.slice(offset, offset + pageSize), total: matching.length, numericTotals: {} });
    }
    const recordMatch = path.match(/^\/api\/records\/(\d+)$/);
    if (recordMatch) {
      const id = Number(recordMatch[1]);
      const record = records.find(row => row.id === id);
      if (!record) return reply({ error: "Fixture record not found" }, 404);
      if (request.method() === "GET") {
        detailReads.push(id);
        return reply(record);
      }
      if (request.method() === "PUT" || request.method() === "PATCH") {
        const body = request.postDataJSON() as Record<string, unknown>;
        writes.push({ id, body });
        const fail = await new Promise<boolean>(resolve => {
          pendingMove = { release: (failed = false) => resolve(failed) };
        });
        pendingMove = undefined;
        if (fail) return reply({ error: "Kanban fixture CAS conflict", code: "VERSION_CONFLICT" }, 409);
        Object.assign(record, body, { version: record.version + 1 });
        return reply(record);
      }
    }
    if (path.endsWith("/record-values/query")) return reply([]);
    if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
    if (path.includes("/collaboration/")) return route.abort();
    if (["PUT", "PATCH", "DELETE"].includes(request.method()) ||
      (request.method() === "POST" && !path.endsWith("/filter-values"))) {
      unexpectedWrites.push(`${request.method()} ${path}`);
    }
    return reply([]);
  });
  return {
    queries, writes, records, unexpectedWrites, errors, detailReads,
    releaseMove: (fail = false) => {
      if (!pendingMove) throw new Error("No pending fixture move to release");
      pendingMove.release(fail);
    },
  };
}

async function selectBoard(page: Page) {
  await page.goto(fixturePath);
  const viewSelect = page.getByRole("combobox").filter({ hasText: "Table fixture" });
  await expect(viewSelect).toBeVisible();
  await viewSelect.click();
  await page.getByRole("option", { name: "Board fixture", exact: true }).click();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("card-kanban-1000")).toBeVisible();
  await expect(page.getByTestId("card-kanban-2000")).toBeVisible();
}

function lane(page: Page, key: string) {
  return page.getByTestId(`lane-kanban-${key}`);
}

function laneQueries(queries: Query[]) {
  return queries.filter(query => query.viewId === boardViewId && query.pageSize === 40 &&
    (query.statusIsNull === true || query.statusIds?.length === 1));
}

test("selects a persisted Kanban view and preserves its card field configuration", async ({ page }) => {
  const fixture = await installFixture(page);
  await selectBoard(page);
  await expect(page.getByRole("combobox").filter({ hasText: "Board fixture" })).toBeVisible();
  await expect(page.getByTestId("kanban-board").locator("[data-kanban-lane]")).toHaveCount(3);
  const card = page.getByTestId("card-kanban-1000");
  await expect(card.getByRole("button", { name: "Item 1000", exact: true })).toBeVisible();
  await expect(card.locator("dt")).toHaveText(["summary:"]);
  await expect(card).toContainText("Summary 1000");
  await expect(card).not.toContainText("Full detail 1000");
  await expect(card).not.toContainText("empty:");
  // The saved view can temporarily render as a table without modifying it.
  await page.getByRole("button", { name: /^(Table|Таблица)$/ }).click();
  await expect(page.getByTestId("kanban-board")).toHaveCount(0);
  await expect(page.getByRole("columnheader").filter({ has: page.getByRole("button", { name: "title", exact: true }) })).toBeVisible();
  await page.getByRole("button", { name: /^(Kanban|Канбан)$/ }).click();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("one non-default configured view applies automatically without a selector", async ({ page }) => {
  const fixture = await installFixture(page, { viewMode: "single" });
  await page.goto(fixturePath);
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("records-view-select")).toHaveCount(0);
  expect(fixture.queries.length).toBeGreaterThan(0);
  expect(fixture.queries.every(query => query.viewId === boardViewId)).toBe(true);
  await page.getByRole("button", { name: /^(Table|Таблица)$/ }).click();
  await expect(page.getByTestId("kanban-board")).toHaveCount(0);
  await page.getByRole("button", { name: /^(Kanban|Канбан)$/ }).click();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("multiple views without a default select the first and exclude all-records", async ({ page }) => {
  const fixture = await installFixture(page, { viewMode: "multiple-no-default" });
  await page.goto(fixturePath);
  const selector = page.getByTestId("records-view-select");
  await expect(selector).toContainText("Table fixture");
  await selector.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: /All records|Все записи/ })).toHaveCount(0);
  await page.getByRole("option", { name: "Board fixture", exact: true }).click();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test("no configured views still renders the base table without a selector", async ({ page }) => {
  const fixture = await installFixture(page, { viewMode: "none" });
  await page.goto(fixturePath);
  await expect(page.getByRole("columnheader").filter({ has: page.getByRole("button", { name: "title", exact: true }) })).toBeVisible();
  await expect(page.getByTestId("records-view-select")).toHaveCount(0);
  await expect(page.getByTestId("kanban-board")).toHaveCount(0);
  expect(fixture.queries.some(query => query.viewId != null)).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("queries each column with exact status filters and paginates independently", async ({ page }) => {
  const fixture = await installFixture(page);
  await selectBoard(page);
  await expect.poll(() => laneQueries(fixture.queries).length).toBeGreaterThanOrEqual(3);
  const initial = laneQueries(fixture.queries);
  expect(initial.some(query => query.statusIsNull === true && query.statusIds === undefined)).toBe(true);
  for (const id of [1, 2]) {
    expect(initial.some(query => query.statusIds?.[0] === id && query.statusIsNull !== true)).toBe(true);
  }
  for (const query of initial) {
    expect(query).toMatchObject({ viewId: boardViewId, page: 1, showHiddenStatuses: false });
    // Main entity pages do not use a mirror-page permission/query scope.
    expect(query.pageId).toBeUndefined();
    expect(query.grouped).toBe(false);
    expect(query.withRowGroups).toBe(false);
  }
  const before = fixture.queries.length;
  await page.getByTestId("button-lane-next-s:1").click();
  await expect.poll(() => fixture.queries.slice(before).some(query => query.statusIds?.[0] === 1 && query.page === 2)).toBe(true);
  await expect(lane(page, "s:1").getByTestId("card-kanban-1040")).toBeAttached();
  await expect(lane(page, "s:1").getByTestId("card-kanban-1000")).toHaveCount(0);
  await expect(lane(page, "s:1").locator("[data-kanban-card]")).toHaveCount(35);
  expect(fixture.queries.slice(before).filter(query => query.page === 2).every(query => query.statusIds?.[0] === 1)).toBe(true);
  await expect(lane(page, "s:2").locator("[data-kanban-card]")).toHaveCount(40);
  await expect(lane(page, "null").locator("[data-kanban-card]")).toHaveCount(1);
  const next = fixture.queries.length;
  await page.getByTestId("button-lane-next-s:2").click();
  await expect.poll(() => fixture.queries.slice(next).some(query => query.statusIds?.[0] === 2 && query.page === 2)).toBe(true);
  await expect(lane(page, "s:2").getByTestId("card-kanban-2040")).toBeAttached();
  await page.getByTestId("button-lane-prev-s:1").click();
  await expect(lane(page, "s:1").getByTestId("card-kanban-1000")).toBeVisible();
  await expect(lane(page, "s:2").getByTestId("card-kanban-2040")).toBeVisible();
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("hidden-status toggle includes and removes the hidden column", async ({ page }) => {
  const fixture = await installFixture(page);
  await selectBoard(page);
  await expect(lane(page, "s:3")).toHaveCount(0);
  expect(laneQueries(fixture.queries).some(query => query.statusIds?.[0] === 3)).toBe(false);
  const toggle = page.getByRole("checkbox", { name: /Show hidden|Показать скрытые/ });
  await toggle.check();
  await expect(lane(page, "s:3")).toBeVisible();
  await expect(lane(page, "s:3").getByTestId("card-kanban-300")).toBeVisible();
  await expect.poll(() => laneQueries(fixture.queries).some(query =>
    query.statusIds?.[0] === 3 && query.showHiddenStatuses === true)).toBe(true);
  await toggle.uncheck();
  await expect(lane(page, "s:3")).toHaveCount(0);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("column tint follows status colors without coloring cards and can be disabled", async ({ page }) => {
  const options = { tintColumns: true };
  const fixture = await installFixture(page, options);
  await selectBoard(page);
  const background = (key: string) => lane(page, key).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await background("s:1")).not.toBe(await background("s:2"));
  expect(await background("null")).not.toBe(await background("s:1"));
  for (const id of [1000, 2000]) {
    await expect(page.getByTestId(`card-kanban-${id}`)).toHaveCSS("background-color", "rgb(255, 255, 255)");
  }
  await page.screenshot({ path: "/tmp/kanban-tinted-columns.png" });
  options.tintColumns = false;
  await selectBoard(page);
  expect(await background("s:1")).toBe(await background("s:2"));
  expect(await lane(page, "s:1").evaluate(el => (el as HTMLElement).style.backgroundColor)).toBe("");
  expect(fixture.errors).toEqual([]);
});

for (const cardDirection of ["ltr", "rtl", null] as const) {
  test(`card direction ${cardDirection ?? "inherited"} controls header and footer independently of board direction`, async ({ page }) => {
    const fixture = await installFixture(page, { editable: true, cardDirection });
    await selectBoard(page);
    const card = page.getByTestId("card-kanban-1000");
    const title = page.getByTestId("button-open-kanban-1000");
    await expect(card).toHaveAttribute("dir", cardDirection ?? "ltr");
    await expect(title.locator("span")).toHaveAttribute("dir", cardDirection ?? "ltr");
    await expect(card.locator("dl")).toHaveAttribute("dir", cardDirection ?? "ltr");
    await title.hover();
    await expect(title).toHaveCSS("text-decoration-line", "none");
    // Changing the outer layout must not override the effective card direction.
    for (const dir of ["ltr", "rtl"]) {
      await page.evaluate(dir => document.documentElement.dir = dir, dir);
      const rect = (await card.boundingBox())!;
      const eye = (await page.getByTestId("button-view-kanban-1000").boundingBox())!;
      const grip = (await page.getByTestId("handle-kanban-1000").boundingBox())!;
      const menu = (await page.getByTestId("button-actions-kanban-1000").boundingBox())!;
      const rtl = cardDirection === "rtl";
      expect(rtl ? eye.x < rect.x + rect.width / 2 : eye.x > rect.x + rect.width / 2).toBe(true);
      expect(rtl ? grip.x > menu.x : grip.x < menu.x).toBe(true);
    }
    expect(fixture.errors).toEqual([]);
  });
}

for (const editable of [false, true]) {
  test(`full read-only detail is separate from editing (update permission: ${editable})`, async ({ page }) => {
    const fixture = await installFixture(page, { editable });
    await selectBoard(page);
    await expect(page.getByTestId("button-edit-kanban-1000")).toHaveCount(editable ? 1 : 0);
    await page.getByTestId("button-view-kanban-1000").click();
    const detail = page.getByTestId("dialog-kanban-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("text-detail-title")).toHaveText("Item 1000");
    await expect(detail.getByTestId("text-detail-summary")).toHaveText("Summary 1000");
    await expect(detail.getByTestId("text-detail-detail")).toHaveText("Full detail 1000");
    await expect(detail.getByTestId("text-detail-empty")).toHaveText("—");
    expect(fixture.detailReads).toContain(1000);
    await expect(detail.locator("input, textarea, [contenteditable=true]")).toHaveCount(0);
    if (editable) {
      await page.keyboard.press("Escape");
      await page.getByTestId("button-edit-kanban-1000").click();
      await expect(detail).toHaveCount(0);
      const edit = page.getByRole("dialog");
      await expect(edit.getByRole("heading", { name: /^(Edit record|Редактировать запись)$/ })).toBeVisible();
      await expect(edit.locator('input[value="Full detail 1000"]')).toBeVisible();
    } else {
      await expect(detail.getByTestId("button-kanban-detail-edit")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByTestId("button-actions-kanban-1000").click();
      await expect(page.getByRole("menuitem", { name: /^(Edit|Редактировать)$/ })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Working", exact: true })).toHaveCount(0);
    }
    expect(fixture.writes).toEqual([]);
    expect(fixture.unexpectedWrites).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

for (const fail of [false, true]) {
  test(`status move is optimistic and ${fail ? "rolls back a failed CAS" : "reconciles a successful CAS"}`, async ({ page }) => {
    const fixture = await installFixture(page, { editable: true });
    await selectBoard(page);
    await expect(page.getByTestId("text-lane-count-s:1")).toHaveText("75");
    await expect(page.getByTestId("text-lane-count-s:2")).toHaveText("75");
    await page.getByTestId("button-actions-kanban-1000").click();
    await page.getByRole("menuitem", { name: "Working", exact: true }).click();
    await expect.poll(() => fixture.writes.length).toBe(1);
    expect(fixture.writes[0]).toEqual({ id: 1000, body: { statusId: 2, expectedVersion: 7 } });
    // The server response is held: the card and counts must already move.
    await expect(lane(page, "s:1").getByTestId("card-kanban-1000")).toHaveCount(0);
    await expect(lane(page, "s:2").getByTestId("card-kanban-1000")).toBeVisible();
    await expect(page.getByTestId("text-lane-count-s:1")).toHaveText("74");
    await expect(page.getByTestId("text-lane-count-s:2")).toHaveText("76");
    const beforeResponse = fixture.queries.length;
    fixture.releaseMove(fail);
    await expect.poll(() => fixture.queries.length).toBeGreaterThan(beforeResponse);
    const source = lane(page, fail ? "s:1" : "s:2");
    const other = lane(page, fail ? "s:2" : "s:1");
    await expect(source.getByTestId("card-kanban-1000")).toBeVisible();
    await expect(other.getByTestId("card-kanban-1000")).toHaveCount(0);
    await expect(page.getByTestId("text-lane-count-s:1")).toHaveText(fail ? "75" : "74");
    await expect(page.getByTestId("text-lane-count-s:2")).toHaveText(fail ? "75" : "76");
    if (fail) await expect(page.getByText("Kanban fixture CAS conflict", { exact: true })).toBeVisible();
    expect(fixture.records.find(record => record.id === 1000)?.version).toBe(fail ? 7 : 8);
    expect(fixture.unexpectedWrites).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test("many cards scroll within a viewport-bounded board instead of growing the document", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await installFixture(page, { manyCards: true });
  await selectBoard(page);
  const board = page.getByTestId("kanban-board");
  const scroller = lane(page, "s:1").locator("[data-kanban-scroller]");
  const before = await board.evaluate(el => ({
    height: el.getBoundingClientRect().height,
    documentHeight: document.documentElement.scrollHeight,
  }));
  const scrollDimensions = await scroller.evaluate(el => ({
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY,
  }));
  expect(before.height).toBeGreaterThan(300);
  expect(before.height).toBeLessThanOrEqual(900);
  expect(scrollDimensions.overflowY).toBe("auto");
  expect(scrollDimensions.scrollHeight).toBeGreaterThan(scrollDimensions.clientHeight);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  // Replacing one bounded page with the next must not enlarge the board.
  await page.getByTestId("button-lane-next-s:1").click();
  await expect(lane(page, "s:1").getByTestId("card-kanban-1040")).toBeAttached();
  const after = await board.evaluate(el => ({
    height: el.getBoundingClientRect().height,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.documentHeight - before.documentHeight)).toBeLessThanOrEqual(1);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(fixture.errors).toEqual([]);
});

test("mouse drag keeps its gesture active through horizontal auto-scroll", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 900 });
  const fixture = await installFixture(page, { editable: true });
  await selectBoard(page);
  const title = page.getByTestId("button-open-kanban-1000");
  await title.scrollIntoViewIfNeeded();
  const titleBox = (await title.boundingBox())!;
  // Drag within the same title button: the generated click must not open detail.
  await page.mouse.move(titleBox.x + 12, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBox.x + 35, titleBox.y + titleBox.height / 2, { steps: 4 });
  await expect(page.getByTestId("card-kanban-1000")).toHaveClass(/opacity-30/);
  await page.mouse.up();
  await expect(page.getByTestId("dialog-kanban-detail")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);

  const board = page.getByTestId("kanban-board");
  expect(await board.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const before = await board.evaluate(el => el.scrollLeft);
  const boardBox = (await board.boundingBox())!;
  const dragBox = (await title.boundingBox())!;
  await page.mouse.move(dragBox.x + 12, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 35, dragBox.y + dragBox.height / 2, { steps: 4 });
  await expect(page.getByTestId("card-kanban-1000")).toHaveClass(/opacity-30/);
  await page.mouse.move(boardBox.x + boardBox.width - 5, dragBox.y + dragBox.height / 2, { steps: 12 });
  await expect.poll(() => board.evaluate(el => el.scrollLeft)).toBeGreaterThan(before);
  await expect.poll(() => lane(page, "s:2").evaluate(el => {
    const rect = el.getBoundingClientRect();
    const parent = el.closest('[data-testid="kanban-board"]')!.getBoundingClientRect();
    return rect.right <= parent.right + 1;
  })).toBe(true);
  const targetBox = (await lane(page, "s:2").locator("[data-kanban-scroller]").boundingBox())!;
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 35, { steps: 8 });
  await expect(lane(page, "s:2")).toHaveClass(/border-slate-500/);
  await page.mouse.up();
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toEqual({ id: 1000, body: { statusId: 2, expectedVersion: 7 } });
  await expect(lane(page, "s:1").getByTestId("card-kanban-1000")).toHaveCount(0);
  await expect(lane(page, "s:2").getByTestId("card-kanban-1000")).toBeVisible();
  await expect(page.getByTestId("dialog-kanban-detail")).toHaveCount(0);
  await expect(page.getByTestId("text-lane-count-s:1")).toHaveText("74");
  await expect(page.getByTestId("text-lane-count-s:2")).toHaveText("76");
  fixture.releaseMove();
  await expect.poll(() => fixture.records.find(record => record.id === 1000)?.version).toBe(8);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("mouse drag from card body moves without selecting text or opening detail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await installFixture(page, { editable: true });
  await selectBoard(page);
  const title = page.getByTestId("button-open-kanban-1000");
  await expect(title).toHaveCSS("cursor", "pointer");
  const originalColor = await title.evaluate(el => getComputedStyle(el).color);
  await title.hover();
  await expect.poll(() => title.evaluate(el => getComputedStyle(el).color)).not.toBe(originalColor);
  const source = (await page.getByTestId("card-kanban-1000").locator("dd").first().boundingBox())!;
  const destination = (await lane(page, "s:2").locator("[data-kanban-scroller]").boundingBox())!;
  await page.mouse.move(source.x + 12, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + destination.width / 2, destination.y + 35, { steps: 15 });
  await expect(lane(page, "s:2")).toHaveClass(/border-slate-500/);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toEqual({ id: 1000, body: { statusId: 2, expectedVersion: 7 } });
  await expect(lane(page, "s:1").getByTestId("card-kanban-1000")).toHaveCount(0);
  await expect(lane(page, "s:2").getByTestId("card-kanban-1000")).toBeVisible();
  await expect(page.getByTestId("dialog-kanban-detail")).toHaveCount(0);
  fixture.releaseMove();
  await expect.poll(() => fixture.records.find(record => record.id === 1000)?.version).toBe(8);
  expect(fixture.unexpectedWrites).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test.describe("touch dragging", () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });

  test("touch handle moves a card between columns with optimistic CAS", async ({ page }) => {
    const fixture = await installFixture(page, { editable: true });
    await selectBoard(page);
    await page.screenshot({ path: "screenshots/kanban-desktop.png", fullPage: true });
    const handle = page.getByTestId("handle-kanban-1000");
    const handleBox = (await handle.boundingBox())!;
    const targetBox = (await lane(page, "s:2").locator("[data-kanban-scroller]").boundingBox())!;
    const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 35 };
    const session = await page.context().newCDPSession(page);
    // Real Chromium touch input (not synthetic DOM pointer events).
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 20, y: start.y, id: 1 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...end, id: 1 }] });
    await expect(lane(page, "s:2")).toHaveClass(/border-slate-500/);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => fixture.writes.length).toBe(1);
    expect(fixture.writes[0]).toEqual({ id: 1000, body: { statusId: 2, expectedVersion: 7 } });
    await expect(lane(page, "s:1").getByTestId("card-kanban-1000")).toHaveCount(0);
    await expect(lane(page, "s:2").getByTestId("card-kanban-1000")).toBeVisible();
    await expect(page.getByTestId("dialog-kanban-detail")).toHaveCount(0);
    fixture.releaseMove();
    await expect.poll(() => fixture.records.find(record => record.id === 1000)?.version).toBe(8);
    await session.detach();
    expect(fixture.unexpectedWrites).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
});