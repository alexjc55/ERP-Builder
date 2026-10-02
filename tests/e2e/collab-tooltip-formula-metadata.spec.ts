import { expect, test, type Page, type Route } from "@playwright/test";

// Entirely mock-only: unknown API requests fail closed, including all writes.
const ENTITY = 7;
const PAGE = 42;
const RESTRICTED_PAGE = 43;
const PATH = "/collab-tooltip-formula-fixture";
const NOW = "2025-01-01T00:00:00.000Z";

async function installFixture(page: Page, language: "en" | "he", grouped = false) {
  const unknown: string[] = [];
  let metadataMode: "hold" | "error" | "ready" | "denied" = grouped ? "hold" : "ready";
  let release!: () => void;
  let seen!: () => void;
  const projectionSeen = new Promise<void>((resolve) => { seen = resolve; });
  const projectionGate = new Promise<void>((resolve) => { release = resolve; });
  let projectionRequests = 0;
  const field = (key: string, type: string, order: number, extra = {}) => ({
    id: 701 + order, entityId: ENTITY, fieldKey: key, fieldType: type,
    nameJson: { en: key, he: key }, isRequired: false, isFilterable: false,
    showInTable: true, isPinned: false, showColumnTotal: false, wrapText: false,
    permissionsJson: { "1": "edit" }, optionsJson: [], sortOrder: order,
    isActive: true, createdAt: NOW, updatedAt: NOW, ...extra,
  });
  const fields = [
    field("title", "text", 0),
    field("lookup_owner", "lookup", 1, { relationConfigJson: { relationId: 1, relatedFieldKey: "owner" }, showInTable: false }),
    field("owner_formula", "function", 2, { formulaConfigJson: { expression: "{entity:7.lookup_owner}" } }),
    field("numeric_formula", "function", 3, { formulaConfigJson: { expression: "42" } }),
    field("last_title", "text", 4),
    field("category", "text", 5, { showInTable: false }),
  ];
  const pageMetadata = {
    id: PAGE, nameJson: { en: "Tooltip and provenance fixture" }, path: PATH,
    parentPageId: null, mirrorEntityId: ENTITY, mirrorFieldKeysJson: null,
    isActive: true, isDashboard: false, isPivot: false, sortOrder: 0,
    groupByFieldKey: grouped ? "category" : null, groupDefaultExpanded: false,
    createdAt: NOW, updatedAt: NOW,
  };
  const entity = {
    id: ENTITY, entityKey: "tooltip_provenance_fixture", nameJson: { en: "Fixture records" },
    pageId: null, allowNoStatus: true, statusManualEditPolicy: "allowed",
    defaultPageSize: 50, defaultSortJson: [], defaultFilterJson: [],
    isActive: true, pivotEnabled: false, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
  };
  const records = Array.from({ length: grouped ? 2 : 35 }, (_, index) => ({
    id: 100 + index, entityId: ENTITY, version: 1, statusId: null,
    valuesJson: { title: `Record ${index + 1} title`, last_title: `Record ${index + 1} last title`, category: "Bucket", owner_formula: 42, numeric_formula: 42 },
    archivedAt: null, createdAt: NOW, updatedAt: NOW,
  }));
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
  await page.addInitScript(() => {
    localStorage.setItem("erp_token", "mock-tooltip-provenance-token");
    const originalFetch = window.fetch.bind(window);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const send = (event: string, value: unknown) => controller?.enqueue(
      new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`),
    );
    (window as unknown as { publishFixturePresence: (presence: unknown[]) => void }).publishFixturePresence =
      (presence) => send("presence", { presence });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/collaboration/pages/") && url.includes("/stream")) {
        return new Response(new ReadableStream({
          start(value) { controller = value; send("snapshot", { presence: [] }); },
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      return originalFetch(input, init);
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === "GET" && path === "/api/auth/me") return json(route, {
      id: 1, email: "tooltip@example.test", firstName: "Fixture", lastName: "Viewer",
      roleId: 1, roleIds: [1], roleName: { en: "Fixture" }, language,
      direction: language === "he" ? "rtl" : "ltr", startPageId: PAGE, isActive: true,
      permissions: { superAdmin: false, admin: {}, pageIds: [PAGE, RESTRICTED_PAGE], dashboard: false,
        records: { "7": { view: true, update: true, create: false, delete: false, scope: "all" } } },
    });
    if (method === "GET" && path === "/api/pages") return json(route, [
      pageMetadata,
      { ...pageMetadata, id: RESTRICTED_PAGE, path: `${PATH}-restricted`, nameJson: { en: "Restricted fixture" } },
    ]);
    if (method === "GET" && path === "/api/entities") return json(route, [entity]);
    if (method === "GET" && path === `/api/entities/${ENTITY}`) return json(route, entity);
    if (method === "GET" && path === `/api/entities/${ENTITY}/fields`) return json(route, fields);
    if (method === "GET" && path === "/api/settings") return json(route, {
      appNameJson: { en: "ERP" }, subtitleJson: {}, defaultLanguage: language,
      textDirection: language === "he" ? "rtl" : "ltr", timeZone: "UTC",
      workingDays: [1, 2, 3, 4, 5], firstDayOfWeek: 1, tableStyle: "plain", updatedAt: NOW,
    });
    if (method === "GET" && path === "/api/users/options") return json(route, [{ id: 42, name: "Ada Authorized", roleId: 1, roleIds: [1] }]);
    if (method === "GET" && [PAGE, RESTRICTED_PAGE].some((id) => path === `/api/pages/${id}/dashboard/data`)) return json(route, []);
    if (method === "GET" && [
      `/api/pages/${PAGE}/fields`, `/api/pages/${PAGE}/views`,
      `/api/pages/${RESTRICTED_PAGE}/fields`, `/api/pages/${RESTRICTED_PAGE}/views`,
      `/api/entities/${ENTITY}/main-views`, `/api/entities/${ENTITY}/statuses`,
      `/api/entities/${ENTITY}/transitions`, `/api/entities/${ENTITY}/relations`,
      `/api/entities/${ENTITY}/custom-filters`, "/api/column-groups", "/api/roles", "/api/translations",
    ].includes(path)) return json(route, []);
    if (method === "PUT" && [PAGE, RESTRICTED_PAGE].some((id) => path === `/api/collaboration/pages/${id}/presence`)) return json(route, { success: true });
    if (method === "POST" && path === `/api/entities/${ENTITY}/records/query`) {
      const body = route.request().postDataJSON();
      return json(route, { data: records, total: records.length, numericTotals: {},
        ...(grouped && body.grouped ? {
          groups: [{ key: "Bucket", label: "Bucket", count: records.length, sums: {}, values: { owner_formula: 42, numeric_formula: 42 } }],
          rowGroups: Object.fromEntries(records.map((record) => [record.id, "Bucket"])),
        } : {}),
      });
    }
    if (method === "POST" && [PAGE, RESTRICTED_PAGE].some((id) => path === `/api/pages/${id}/record-values/query`)) return json(route, []);
    if (method === "POST" && path === `/api/entities/${ENTITY}/related-values`) {
      projectionRequests += 1;
      if (metadataMode === "hold") { seen(); await projectionGate; }
      if (metadataMode === "error") return json(route, { error: "Authorized projection failed" }, 500);
      const denied = metadataMode === "denied" || route.request().postDataJSON().pageId === RESTRICTED_PAGE;
      return json(route, {
        columns: denied ? [] : [{ fieldKey: "lookup_owner", relatedFieldType: "user", optionsJson: [], canEdit: false }],
        values: denied ? [] : records.map((record) => ({ recordId: record.id, fieldKey: "lookup_owner", value: 42, linkedRecordId: 900 })),
      });
    }
    unknown.push(`${method} ${path}`);
    return json(route, { error: `Unexpected mock request: ${method} ${path}` }, 404);
  });
  return {
    unknown, projectionSeen, get projectionRequests() { return projectionRequests; },
    releaseWith(mode: "error" | "ready" | "denied") { metadataMode = mode; release(); },
    setMetadataMode(mode: "error" | "ready" | "denied") { metadataMode = mode; },
    async presence(cells: Array<{ recordId: number; fieldKey: string }>, name = "Remote Editor") {
      await page.evaluate(({ cells, name }) => {
        (window as unknown as { publishFixturePresence: (presence: unknown[]) => void }).publishFixturePresence(
          cells.map((cell, index) => ({ userId: 2 + index, clientId: `remote-${index}`, name, color: "#3b82f6",
            editing: { ...cell, entityId: 7, source: "entity" } })),
        );
      }, { cells, name });
    },
  };
}

for (const language of ["en", "he"] as const) {
  test(`collab tooltip: viewport edges, keyboard and stable editor (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 720 });
    const api = await installFixture(page, language);
    await page.goto(PATH);
    const cell = page.locator('[data-testid="record-cell"][data-record-id="100"][data-field-key="title"]');
    await expect(cell).toContainText("Record 1 title");
    await cell.click();
    const input = cell.locator("input");
    await expect(input).toBeVisible();
    await input.fill("Unsaved local draft");
    await input.evaluate((element: HTMLInputElement) => {
      element.setSelectionRange(2, 8);
      (window as unknown as { originalFixtureEditor: HTMLElement }).originalFixtureEditor = element;
    });
    await api.presence([{ recordId: 100, fieldKey: "title" }, { recordId: 100, fieldKey: "last_title" }]);
    await expect(page.getByTestId("cell-collab-popover")).toBeVisible();
    await api.presence([{ recordId: 100, fieldKey: "title" }], "Updated Remote Name");
    await expect(page.getByTestId("cell-collab-popover")).toContainText("Updated Remote Name");
    await expect(input).toHaveValue("Unsaved local draft");
    await expect(input).toBeFocused();
    expect(await input.evaluate((element: HTMLInputElement) => ({
      same: element === (window as unknown as { originalFixtureEditor: HTMLElement }).originalFixtureEditor,
      start: element.selectionStart, end: element.selectionEnd,
    }))).toEqual({ same: true, start: 2, end: 8 });
    await input.press("Escape");
    // Keyboard reaches the collaboration trigger; focusing must open a portal,
    // not an absolutely positioned descendant of a clipping table container.
    const wrapper = cell.locator("[aria-describedby]").first();
    await wrapper.focus();
    const tooltip = page.getByTestId("cell-collab-popover");
    await expect(tooltip).toBeVisible();
    expect(await tooltip.evaluate((element) => element.parentElement === document.body)).toBe(true);
    expect(await wrapper.getAttribute("aria-describedby")).toBe(await tooltip.getAttribute("id"));
    await api.presence([{ recordId: 100, fieldKey: "title" }, { recordId: 100, fieldKey: "last_title" }]);
    const descriptions = await page.locator('[data-testid="record-cell"] [aria-describedby]').evaluateAll(
      (elements) => elements.map((element) => element.getAttribute("aria-describedby")),
    );
    expect(new Set(descriptions).size).toBe(descriptions.length);
    // Move the real collaboration anchor to each viewport edge, keeping the
    // table's clipping ancestors. This isolates the collision geometry from
    // application-specific column widths and screen chrome.
    for (const [left, top] of [[8, 8], [880, 8], [8, 672], [880, 672]]) {
      await wrapper.evaluate((element: HTMLElement, position) => {
        element.style.position = "fixed";
        element.style.left = `${position.left}px`;
        element.style.top = `${position.top}px`;
        element.style.width = "100px";
        element.style.height = "32px";
        window.dispatchEvent(new Event("resize"));
      }, { left, top });
      await expect.poll(async () => {
        const box = await tooltip.boundingBox();
        return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= 993 && box.y + box.height <= 713;
      }).toBe(true);
    }
    await wrapper.press("Escape");
    await expect(tooltip).toHaveCount(0);
    expect(api.unknown).toEqual([]);
  });
}

test("formula groups: no id flash during delay/error, retry names, ordinary numbers remain numeric", async ({ page }) => {
  const api = await installFixture(page, "en", true);
  await page.goto(PATH);
  await api.projectionSeen;
  const group = page.locator('tr[data-group-key="Bucket"]');
  await expect(group).toBeVisible();
  await expect(group.getByTestId("group-formula-state")).toHaveAttribute("data-state", "pending");
  // Collapsed headers must have the same safe presentation as expanded rows.
  await expect(page.locator('[data-testid="record-cell"]')).toHaveCount(0);
  expect(await group.locator("td").allTextContents()).toContain("42");
  await expect(group.getByTestId("group-formula-state")).not.toContainText("42");
  api.releaseWith("error");
  await expect(group.getByTestId("group-formula-state")).toHaveAttribute("data-state", "unavailable");
  await expect(group.getByTestId("group-formula-state")).not.toContainText("42");
  api.setMetadataMode("ready");
  await group.locator('[data-testid^="retry-group-formula-"]').click();
  await expect(group).toContainText("Ada Authorized");
  await expect(group.getByTestId("group-formula-state")).toHaveCount(0);
  await group.click();
  await expect(page.locator('[data-testid="record-cell"][data-field-key="owner_formula"]').first()).toContainText("Ada Authorized");
  expect(api.projectionRequests).toBeGreaterThanOrEqual(2);
  // Navigate through the real sidebar into another permission projection scope.
  // The same entity/field ids deliberately recur, but authorized type metadata
  // is withheld there. Neither a stale user name nor the id may be presented.
  await page.getByRole("link", { name: "Restricted fixture", exact: true }).click();
  await expect(page).toHaveURL(`${PATH}-restricted`);
  const restrictedGroup = page.locator('tr[data-group-key="Bucket"]');
  await expect(restrictedGroup.getByTestId("group-formula-state")).toHaveAttribute("data-state", "unavailable");
  await expect(restrictedGroup).not.toContainText("Ada Authorized");
  await expect(restrictedGroup.getByTestId("group-formula-state")).not.toContainText("42");
  expect(await restrictedGroup.locator("td").allTextContents()).toContain("42");
  expect(api.unknown).toEqual([]);
});