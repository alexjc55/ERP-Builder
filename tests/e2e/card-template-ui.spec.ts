import { expect, test, type Page, type Route } from "@playwright/test";

// Route-intercepted frontend tests for the card builder and runtime card.
// Every /api request is fulfilled here; no real API/DB data is touched.

const A = 880101, B = 880102, PAGE_A = 880201, PAGE_B = 880202, REL = 880301;
const ml = (en: string) => ({ en, ru: en, he: en });
const entities = [
  { id: A, pageId: PAGE_A, entityKey: "card_orders", nameJson: ml("Orders"), isActive: true, allowNoStatus: true, defaultPageSize: 50 },
  { id: B, pageId: PAGE_B, entityKey: "card_items", nameJson: ml("Items"), isActive: true, allowNoStatus: true, defaultPageSize: 50 },
];
const pages = [
  { id: PAGE_A, path: "/card-orders", nameJson: ml("Orders"), isActive: true },
  { id: PAGE_B, path: "/card-items", nameJson: ml("Items"), isActive: true },
];
const field = (id: number, entityId: number, fieldKey: string, fieldType: string, extra: Record<string, unknown> = {}) => ({
  id, entityId, fieldKey, nameJson: ml(fieldKey === "title" ? "Title" : fieldKey === "items" ? "Line items" : fieldKey === "name" ? "Item name" : fieldKey),
  fieldType, sortOrder: id, isActive: true, showInTable: true, permissionsJson: {}, optionsJson: [], isRequired: false, ...extra,
});
const fieldsA = [
  field(1, A, "title", "text"),
  field(2, A, "note", "text"),
  field(3, A, "items", "relation", { relationConfigJson: { relationId: REL, selectionMode: "multiple", relatedFieldKey: "name", allowCreate: true } }),
];
const fieldsB = [field(11, B, "name", "text"), field(12, B, "qty", "number")];

const layout = (secondTabTitle: string) => ({
  version: 1, style: "standard", customStyle: {},
  tabs: [
    { id: "tab_main", title: ml("Main"), sections: [{ id: "sec_main", title: ml("Basics"), columns: 2, blocks: [
      { id: "blk_title", kind: "field", fieldKey: "title", span: 1, modes: ["view", "create", "edit"], columns: [] },
      { id: "blk_note", kind: "field", fieldKey: "note", span: 1, modes: ["view", "create", "edit"], columns: [] },
      { id: "blk_text", kind: "text", text: ml("Fill the order header"), span: 2, modes: ["view", "create", "edit"], columns: [] },
    ] }] },
    { id: "tab_lines", title: ml(secondTabTitle), sections: [{ id: "sec_lines", title: {}, columns: 1, blocks: [
      { id: "blk_items", kind: "relatedTable", fieldKey: "items", span: 3, modes: ["view", "create", "edit"], columns: ["name", "qty"] },
    ] }] },
  ],
});

function me(superAdmin: boolean) {
  return {
    id: 1, email: "cards@example.test", firstName: "Card", roleId: 1, roleIds: [1], language: "en", direction: "ltr", isActive: true,
    permissions: { superAdmin, pageIds: [PAGE_A, PAGE_B], admin: { cardTemplates: true }, records: {
      [A]: { view: true, create: true, update: true, delete: false, scope: "all" },
      [B]: { view: true, create: true, update: true, delete: false, scope: "all" },
    } },
  };
}

async function common(route: Route, path: string): Promise<boolean> {
  const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  if (path === "/api/auth/me") { await reply(me(true)); return true; }
  if (path === "/api/pages") { await reply(pages); return true; }
  if (path === "/api/entities") { await reply(entities); return true; }
  if (path === `/api/entities/${A}`) { await reply(entities[0]); return true; }
  if (path === `/api/entities/${B}`) { await reply(entities[1]); return true; }
  if (path === "/api/settings") { await reply({ defaultLanguage: "en", timeZone: "UTC" }); return true; }
  if (path === `/api/entities/${A}/fields`) { await reply(fieldsA); return true; }
  if (path === `/api/entities/${B}/fields`) { await reply(fieldsB); return true; }
  if (path.endsWith("/relations")) { await reply([{ id: REL, sourceEntityId: A, targetEntityId: B }]); return true; }
  if (path.includes("/collaboration/")) { await route.abort(); return true; }
  return false;
}

async function auth(page: Page) {
  await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-card-ui"));
}

test("builder: copy across entities clears bindings; publish asks before replacing the active card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await auth(page);
  const published = { id: 1, name: "Order card", entityId: A, pageId: null, state: "published", layout: layout("Lines"), revision: 3 };
  const draft = { id: 2, name: "Order card v2", entityId: A, pageId: null, state: "draft", layout: layout("Lines v2"), revision: 1 };
  const creates: Record<string, any>[] = [];
  const publishes: Record<string, any>[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates" && req.method() === "GET") return reply([published, draft]);
    if (path === "/api/card-templates" && req.method() === "POST") {
      const body = req.postDataJSON(); creates.push(body);
      return reply({ id: 9, state: "draft", revision: 1, ...body });
    }
    if (path === "/api/card-templates/2/publish") {
      const body = req.postDataJSON(); publishes.push(body);
      if (body.replaceId == null) return reply({ error: "Another template is active", active: published }, 409);
      return reply({ ...draft, state: "published", revision: 2 });
    }
    return reply([]);
  });

  await page.goto("/admin/card-templates");
  await expect(page.getByTestId("row-template-1")).toBeVisible();

  // Cross-entity copy: structure kept, bindings cleared, ids regenerated.
  await page.getByTestId("button-copy-1").click();
  const dlg = page.getByTestId("dialog-duplicate");
  await dlg.getByTestId("select-entity").click();
  await page.getByRole("option", { name: "Items" }).click();
  await expect(dlg.getByTestId("text-cross-entity")).toBeVisible();
  await dlg.getByTestId("button-confirm-copy").click();
  await expect.poll(() => creates.length).toBe(1);
  const copy = creates[0];
  expect(copy.entityId).toBe(B);
  expect(copy.layout.tabs).toHaveLength(2);
  const blocks = copy.layout.tabs.flatMap((t: any) => t.sections.flatMap((s: any) => s.blocks));
  expect(blocks).toHaveLength(4);
  for (const b of blocks.filter((b: any) => b.kind === "field" || b.kind === "relatedTable")) {
    expect(b.fieldKey).toBeNull();
    expect(b.columns).toEqual([]);
  }
  expect(blocks.find((b: any) => b.kind === "text").text.en).toBe("Fill the order header");
  expect(blocks.map((b: any) => b.id)).not.toContain("blk_title");
  await expect(page).toHaveURL(/\/admin\/card-templates\/9$/);

  // Publication: 409 -> explicit confirmation -> resend with replace ids.
  await page.goto("/admin/card-templates");
  await page.getByTestId("button-publish-2").click();
  const conflict = page.getByTestId("dialog-publish-conflict");
  await expect(conflict).toBeVisible();
  await expect(conflict.getByTestId("text-conflict-active")).toContainText("Order card");
  expect(publishes).toEqual([{ expectedRevision: 1 }]);
  await conflict.getByTestId("button-conflict-replace").click();
  await expect.poll(() => publishes.length).toBe(2);
  expect(publishes[1]).toEqual({ expectedRevision: 1, replaceId: 1, replaceRevision: 3 });
  await expect(conflict).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("runtime: tabs/columns, snapshot survives a publication, view is read-only, related table distinguishes denied records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await auth(page);
  let currentLayout = layout("Lines");
  const resolves: Record<string, any>[] = [];
  const writes: string[] = [];
  const record = { id: 50, entityId: A, statusId: null, valuesJson: { title: "Order 50", note: "Rush" }, version: 4, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" };
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates/resolve") {
      resolves.push(req.postDataJSON());
      return reply({ template: { id: 1, name: "Order card", entityId: A, pageId: null, state: "published", revision: 3, layout: currentLayout } });
    }
    if (path === `/api/entities/${A}/records/query`) return reply({ data: [record], total: 1, numericTotals: {} });
    if (path === `/api/entities/${A}/related-values`) return reply({
      columns: [{ fieldKey: "items", relatedEntityId: B, relatedFieldType: "text", optionsJson: [], writeThrough: false }],
      values: [{ recordId: 50, fieldKey: "items", linkedRecordId: 101, linkedRecordIds: [101, 102], value: "Bolt", editable: true, members: [] }],
    });
    if (path === "/api/records/101") return reply({ id: 101, entityId: B, valuesJson: { name: "Bolt M6", qty: 12 }, version: 1, statusId: null });
    if (path === "/api/records/102") return reply({ error: "Forbidden" }, 403);
    if (path.endsWith("/statuses") || path.endsWith("/views")) return reply([]);
    if (["PUT", "DELETE", "PATCH"].includes(req.method())) writes.push(`${req.method()} ${path}`);
    return reply([]);
  });

  await page.goto("/card-orders");
  const viewBtn = page.locator('[data-testid="record-view-button"][data-record-id="50"]');
  await expect(viewBtn).toBeVisible();
  await viewBtn.click();

  const card = page.getByTestId("card-layout");
  await expect(card).toBeVisible();
  expect(resolves[0]).toMatchObject({ entityId: A, mode: "view" });
  await expect(page.getByTestId("card-section-sec_main")).toContainText("Basics");
  await expect(page.getByTestId("card-text-blk_text")).toHaveText("Fill the order header");
  // View is immutable: the title input is disabled, no save, an explicit Edit button.
  await expect(page.getByTestId("form-field-title").locator("input")).toBeDisabled();
  await expect(page.getByTestId("record-dialog-save")).toHaveCount(0);

  // Related table on the second tab: allowed record rendered, 403 counted, not hidden as error.
  await page.getByTestId("card-tab-tab_lines").click();
  await expect(page.getByTestId("row-related-items-101")).toContainText("Bolt M6");
  await expect(page.getByTestId("row-related-items-101")).toContainText("12");
  await expect(page.getByTestId("text-related-denied-items")).toContainText("1");
  await expect(page.getByTestId("button-relation-picker-items")).toBeVisible();

  // Switch to edit; type; a publication happens meanwhile; the open form keeps its layout and the typed value.
  await page.getByTestId("record-dialog-to-edit").click();
  await page.getByTestId("card-tab-tab_main").click();
  const title = page.getByTestId("form-field-title").locator("input");
  await expect(title).toBeEnabled();
  await title.fill("Order 50 edited");
  const resolvesBefore = resolves.length;
  currentLayout = layout("Renamed after publish");
  await page.getByTestId("card-tab-tab_lines").click();
  await page.getByTestId("card-tab-tab_main").click();
  await expect(page.getByTestId("card-tab-tab_lines")).toHaveText("Lines");
  await expect(title).toHaveValue("Order 50 edited");
  expect(resolves.length).toBe(resolvesBefore);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("runtime: a failed resolve shows an explicit error with retry instead of silently using the standard form", async ({ page }) => {
  await auth(page);
  let fail = true;
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates/resolve") return fail ? reply({ error: "boom" }, 500) : reply({ template: null });
    if (path === `/api/entities/${A}/records/query`) return reply({ data: [], total: 0, numericTotals: {} });
    return reply([]);
  });
  await page.goto("/card-orders");
  await page.getByRole("button", { name: /Add record|Добавить запись/ }).first().click();
  await expect(page.getByTestId("card-resolve-error")).toBeVisible();
  await expect(page.getByTestId("record-dialog-save")).toBeDisabled();
  fail = false;
  await page.getByTestId("button-card-resolve-retry").click();
  await expect(page.getByTestId("card-resolve-error")).toHaveCount(0);
  await expect(page.getByTestId("form-field-title")).toBeVisible();
  await expect(page.getByTestId("card-layout")).toHaveCount(0);
});
