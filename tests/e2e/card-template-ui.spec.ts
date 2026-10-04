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

test("builder: custom style uses the shared saved-color palette and clears overrides", async ({ page }) => {
  await auth(page);
  await page.addInitScript(() => localStorage.setItem("erp.colorPresets", JSON.stringify(["#123456"])));
  const draft = { id: 8, name: "Color card", entityId: A, pageId: null, state: "draft", revision: 1, layout: layout("Lines") };
  const saved: any[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates") return reply([draft]);
    if (path === "/api/card-templates/8" && route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saved.push(body);
      return reply({ ...draft, ...body, revision: 2 });
    }
    return reply([]);
  });
  await page.goto("/admin/card-templates/8");
  const preview = page.getByTestId("editor-card-preview");
  const grid = page.getByTestId("editor-section-grid-0");
  const section = page.getByTestId("editor-section-0");
  await expect(grid).toHaveCSS("row-gap", "16px");
  await page.getByTestId("button-style-compact").click();
  await expect(preview).toHaveAttribute("data-card-style", "compact");
  await expect(grid).toHaveCSS("row-gap", "8px");
  await page.getByTestId("button-style-sectioned").click();
  await expect(section).toHaveCSS("background-color", "rgba(248, 250, 252, 0.6)");
  await page.getByTestId("button-style-standard").click();
  await expect(section).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(grid).toHaveCSS("row-gap", "16px");
  await page.getByTestId("button-style-custom").click();
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  for (const key of ["background", "sectionBackground", "accent"]) {
    const control = page.getByTestId(`input-style-${key}`);
    await control.getByRole("button").first().click();
    await expect(page.locator(".react-colorful")).toBeVisible();
    await page.getByTitle("#123456", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".react-colorful")).toHaveCount(0);
    await expect(control.getByRole("textbox")).toHaveValue("#123456");
    const target = key === "background" ? preview : key === "sectionBackground" ? section : page.getByTestId("button-select-section-0");
    await expect(target).toHaveCSS(key === "accent" ? "color" : "background-color", "rgb(18, 52, 86)");
  }
  await page.getByTestId("button-style-standard").click();
  await expect(preview).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByTestId("button-style-custom").click();
  await expect(preview).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await expect(page.getByTestId("editor-block-blk_title")).toBeVisible();
  await expect(page.getByTestId("editor-tab-1")).toBeVisible();
  await page.getByTestId("input-style-accent").getByRole("button").last().click();
  await expect(page.getByTestId("button-select-section-0")).not.toHaveCSS("color", "rgb(18, 52, 86)");
  await page.getByTestId("input-style-textColor").getByRole("textbox").fill("#ffffff");
  await page.getByTestId("input-style-textColor").getByRole("textbox").blur();
  await expect(page.getByTestId("button-select-section-0")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("editor-block-blk_text").getByText("Fill the order header")).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({ path: "screenshots/card-style-live-preview.png" });
  await page.getByTestId("button-save-draft").click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].layout.customStyle).toEqual({ background: "#123456", sectionBackground: "#123456", textColor: "#FFFFFF" });
});

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
  let currentLayout = { ...layout("Lines"), style: "custom", customStyle: { background: "#123456", textColor: "#ffffff" } };
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
  await expect(page.getByTestId("form-field-title").locator("label")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("card-text-blk_text")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(title).not.toHaveCSS("color", "rgb(255, 255, 255)");
  await title.fill("Order 50 edited");
  const resolvesBefore = resolves.length;
  currentLayout = { ...currentLayout, tabs: layout("Renamed after publish").tabs };
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

// ---- explicit rows ------------------------------------------------------------
const rowBlock = (id: string, fieldKey: string | null, span = 1) => ({ id, kind: "field", fieldKey, span, modes: ["view", "create", "edit"], columns: [] });
const rowsLayout = () => ({
  version: 1, style: "standard", customStyle: {},
  tabs: [{ id: "tab_rows", title: ml("Main"), sections: [{ id: "sec_rows", title: ml("Rows"), columns: 1,
    blocks: [rowBlock("b1", "title"), rowBlock("b2", "note"), rowBlock("b3", null), rowBlock("b4", null), rowBlock("b5", null), rowBlock("b6", null, 3), rowBlock("b7", null), rowBlock("b8", null), rowBlock("b9", null)],
    rows: [
      { id: "row_a", columns: 2, blockIds: ["b1", "b2"] }, { id: "row_b", columns: 1, blockIds: ["b3"] },
      { id: "row_c", columns: 3, blockIds: ["b4", "b5", "b6"] }, { id: "row_d", columns: 2, blockIds: ["b7", "b8"] },
      { id: "row_e", columns: 1, blockIds: ["b9"] },
    ] }] }],
});

test("builder: rows 2,1,3,2,1 edit, move, delete without loss, save/reload and cross-entity copy keeps rows", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await auth(page);
  let draft: any = { id: 20, name: "Rows card", entityId: A, pageId: null, state: "draft", revision: 1, layout: rowsLayout() };
  const saved: any[] = [];
  const creates: any[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates" && req.method() === "GET") return reply([draft]);
    if (path === "/api/card-templates" && req.method() === "POST") { const body = req.postDataJSON(); creates.push(body); return reply({ id: 21, state: "draft", revision: 1, ...body }); }
    if (path === "/api/card-templates/20" && req.method() === "PUT") {
      const body = req.postDataJSON(); saved.push(body);
      draft = { ...draft, ...body, revision: draft.revision + 1 };
      return reply(draft);
    }
    return reply([]);
  });
  await page.goto("/admin/card-templates/20");
  for (const [i, n] of [2, 1, 3, 2, 1].entries()) await expect(page.getByTestId(`editor-row-0-${i}`)).toHaveAttribute("data-row-columns", String(n));
  // Explicit and wrapped rows share one gap: the stack gap equals the in-row row gap.
  await expect(page.getByTestId("editor-section-grid-0")).toHaveCSS("row-gap", "16px");

  // Accessible move: b3 joins the end of the previous row; its old row stays (empty rows allowed).
  await page.getByTestId("editor-block-b3").click();
  await page.getByTestId("button-block-row-up").click();
  await expect(page.getByTestId("editor-row-0-0").getByTestId("editor-block-b3")).toBeVisible();
  await expect(page.getByTestId("text-block-row")).toHaveText("1");
    await page.getByTestId("button-row-cols-0-2-1").click();
  await page.getByTestId("button-row-delete-0-3").click(); // row_d -> fields join row_c above
  await expect(page.getByTestId("editor-row-0-2").getByTestId("editor-block-b8")).toBeVisible();
  await expect(page.getByTestId("editor-row-0-4")).toHaveCount(0);
  await page.getByTestId("button-row-up-0-3").click();
  await page.getByTestId("button-save-draft").click();
  await expect.poll(() => saved.length).toBe(1);
  const s = saved[0].layout.tabs[0].sections[0];
  expect(s.blocks).toHaveLength(9);
  expect(s.rows.flatMap((r: any) => r.blockIds).sort()).toEqual(s.blocks.map((b: any) => b.id).sort());
  expect(new Set(s.rows.flatMap((r: any) => r.blockIds)).size).toBe(9);
  expect(s.rows.map((r: any) => r.columns)).toEqual([2, 1, 1, 1]);
  expect(s.blocks.map((b: any) => b.id)).toEqual(s.rows.flatMap((r: any) => r.blockIds));

  // Reload: state comes back from the server copy.
  await page.reload();
  await expect(page.getByTestId("editor-row-0-0").getByTestId("editor-block-b3")).toBeVisible();
  await expect(page.getByTestId("editor-row-0-3")).toHaveAttribute("data-row-columns", "1");

  // Cross-entity copy keeps rows and slots, remaps ids.
  await page.goto("/admin/card-templates");
  await page.getByTestId("button-copy-20").click();
  const dlg = page.getByTestId("dialog-duplicate");
  await dlg.getByTestId("select-entity").click();
  await page.getByRole("option", { name: "Items" }).click();
  await dlg.getByTestId("button-confirm-copy").click();
  await expect.poll(() => creates.length).toBe(1);
  const cs = creates[0].layout.tabs[0].sections[0];
  expect(cs.rows.map((r: any) => r.columns)).toEqual([2, 1, 1, 1]);
  expect(cs.rows.map((r: any) => r.blockIds.length)).toEqual(s.rows.map((r: any) => r.blockIds.length));
  expect(cs.rows.flatMap((r: any) => r.blockIds)).toEqual(cs.blocks.map((b: any) => b.id));
  expect(cs.rows.map((r: any) => r.id)).not.toContain("row_a");
  expect(cs.blocks.every((b: any) => b.fieldKey === null)).toBe(true);
  expect(errors).toEqual([]);
});

test("runtime: explicit rows render 2,1,3,2,1 with equal gaps; empty/hidden rows leave no gap; legacy grid unchanged", async ({ page }) => {
  await auth(page);
  const l: any = rowsLayout();
  const sec = l.tabs[0].sections[0];
  sec.blocks = sec.blocks.map((b: any, i: number) => ({ ...b, kind: i < 2 ? "field" : "text", fieldKey: i < 2 ? b.fieldKey : null, text: ml(`Text ${b.id}`) }));
  sec.blocks[8].modes = ["view"]; // row_e hidden in create
  sec.rows.splice(2, 0, { id: "row_empty", columns: 3, blockIds: [] });
  l.tabs.push({ id: "tab_legacy", title: ml("Legacy"), sections: [{ id: "sec_legacy", title: {}, columns: 2, blocks: [
    { id: "lg1", kind: "text", text: ml("L1"), span: 1, modes: ["view", "create", "edit"], columns: [] },
    { id: "lg2", kind: "text", text: ml("L2"), span: 1, modes: ["view", "create", "edit"], columns: [] },
  ] }] });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates/resolve") return reply({ template: { id: 1, name: "Rows", entityId: A, pageId: null, state: "published", revision: 1, layout: l } });
    if (path === `/api/entities/${A}/records/query`) return reply({ data: [], total: 0, numericTotals: {} });
    return reply([]);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/card-orders");
  await page.getByRole("button", { name: /Add record|Добавить запись/ }).first().click();
  const rows = page.getByTestId("card-rows-sec_rows");
  await expect(rows).toBeVisible();
  await expect(rows).toHaveCSS("row-gap", "16px");
  await expect(page.getByTestId("card-row-row_empty")).toHaveCount(0);
  await expect(page.getByTestId("card-row-row_e")).toHaveCount(0);
  await expect(rows.locator(":scope > div")).toHaveCount(4);
  for (const [id, n] of [["row_a", 2], ["row_b", 1], ["row_c", 3], ["row_d", 2]] as const) {
    await expect(page.getByTestId(`card-row-${id}`)).toHaveAttribute("data-row-columns", String(n));
    await expect(page.getByTestId(`card-row-${id}`)).toHaveCSS("row-gap", "16px");
  }
  // Spacing between explicit rows equals the gap.
  // Poll: the dialog open animation scales the content briefly.
  await expect.poll(async () => {
    const ba = await page.getByTestId("card-row-row_a").boundingBox();
    const bb = await page.getByTestId("card-row-row_b").boundingBox();
    return Math.round(bb!.y - (ba!.y + ba!.height));
  }).toBe(16);
  await page.getByTestId("card-tab-tab_legacy").click();
  await expect(page.getByTestId("card-text-lg2")).toBeVisible();
  await expect(page.getByTestId("card-rows-sec_legacy")).toHaveCount(0);
  // Mobile: one column.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("card-tab-tab_rows").click();
  await expect(page.getByTestId("card-row-row_c")).toHaveCSS("grid-template-columns", /^\S+$/);
});

test("builder: drag a field between rows updates row refs and saves a valid partition", async ({ page }) => {
  await auth(page);
  const draft: any = { id: 30, name: "DnD rows", entityId: A, pageId: null, state: "draft", revision: 1, layout: rowsLayout() };
  const saved: any[] = [];
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates" && req.method() === "GET") return reply([draft]);
    if (path === "/api/card-templates/30" && req.method() === "PUT") { const body = req.postDataJSON(); saved.push(body); return reply({ ...draft, ...body, revision: 2 }); }
    return reply([]);
  });
  await page.goto("/admin/card-templates/30");
  // Row 0 -> end of row 2 (row_c), then row 4's b9 before b7 in row 3 (row_d).
  await page.getByTestId("editor-block-b1").dragTo(page.getByTestId("editor-row-drop-0-2"));
  await expect(page.getByTestId("editor-row-0-2").getByTestId("editor-block-b1")).toBeVisible();
  await page.getByTestId("editor-block-b9").dragTo(page.getByTestId("editor-block-b7"));
  await expect(page.getByTestId("editor-row-0-3").getByTestId("editor-block-b9")).toBeVisible();
  await page.getByTestId("button-save-draft").click();
  await expect.poll(() => saved.length).toBe(1);
  const s = saved[0].layout.tabs[0].sections[0];
  expect(s.rows.map((r: any) => [r.id, r.columns, r.blockIds])).toEqual([
    ["row_a", 2, ["b2"]], ["row_b", 1, ["b3"]], ["row_c", 3, ["b4", "b5", "b6", "b1"]], ["row_d", 2, ["b9", "b7", "b8"]], ["row_e", 1, []],
  ]);
  expect(s.blocks.map((b: any) => b.id)).toEqual(s.rows.flatMap((r: any) => r.blockIds));
  expect(s.blocks.find((b: any) => b.id === "b1")).toMatchObject({ fieldKey: "title", span: 1 });
});

test("runtime: malformed explicit rows surface the snapshot error with retry", async ({ page }) => {
  await auth(page);
  const bad: any = rowsLayout();
  bad.tabs[0].sections[0].rows[4].blockIds = []; // b9 orphaned -> not a partition
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (await common(route, path)) return;
    const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/card-templates/resolve") return reply({ template: { id: 1, name: "Bad", entityId: A, pageId: null, state: "published", revision: 1, layout: bad } });
    if (path === `/api/entities/${A}/records/query`) return reply({ data: [], total: 0, numericTotals: {} });
    return reply([]);
  });
  await page.goto("/card-orders");
  await page.getByRole("button", { name: /Add record|Добавить запись/ }).first().click();
  await expect(page.getByTestId("card-resolve-error")).toBeVisible();
  await expect(page.getByTestId("button-card-resolve-retry")).toBeVisible();
  await expect(page.getByTestId("record-dialog-save")).toBeDisabled();
  await expect(page.getByTestId("card-layout")).toHaveCount(0);
});
