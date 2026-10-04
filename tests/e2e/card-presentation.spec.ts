import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";

// Route-intercepted frontend tests for card presentation modes (modal / side /
// fullscreen). Every /api request is fulfilled here; no real API/DB data is touched.

const A = 890101, B = 890102, PAGE_A = 890201, PAGE_B = 890202, REL = 890301;
const ml = (en: string) => ({ en, ru: en, he: en });
const entities = [
  { id: A, pageId: PAGE_A, entityKey: "pres_orders", nameJson: ml("Orders"), isActive: true, allowNoStatus: true, defaultPageSize: 50 },
  { id: B, pageId: PAGE_B, entityKey: "pres_items", nameJson: ml("Items"), isActive: true, allowNoStatus: true, defaultPageSize: 50 },
];
const pages = [
  { id: PAGE_A, path: "/pres-orders", nameJson: ml("Orders"), isActive: true },
  { id: PAGE_B, path: "/pres-items", nameJson: ml("Items"), isActive: true },
];
const field = (id: number, entityId: number, fieldKey: string, fieldType: string, extra: Record<string, unknown> = {}) => ({
  id, entityId, fieldKey, nameJson: ml(fieldKey === "title" ? "Title" : fieldKey === "items" ? "Line items" : fieldKey),
  fieldType, sortOrder: id, isActive: true, showInTable: true, permissionsJson: {}, optionsJson: [], isRequired: false, ...extra,
});
const fieldsA = [
  field(1, A, "title", "text"),
  field(2, A, "note", "text"),
  field(3, A, "items", "relation", { relationConfigJson: { relationId: REL, selectionMode: "multiple", relatedFieldKey: "name", allowCreate: true } }),
];
const fieldsB = [field(11, B, "name", "text"), field(12, B, "qty", "number")];
const ALL = ["view", "create", "edit"];

// Main tab is long (forces body scroll); the second tab is short. Switching
// between them must never resize the window.
function layout(presentation?: "modal" | "side" | "fullscreen") {
  const filler = Array.from({ length: 40 }, (_, i) => ({ id: `blk_fill_${i}`, kind: "text", text: ml(`Instruction paragraph ${i + 1}`), span: 2, modes: ALL, columns: [] }));
  return {
    version: 1, style: "standard", customStyle: {}, ...(presentation ? { presentation } : {}),
    tabs: [
      { id: "tab_main", title: ml("Main"), sections: [{ id: "sec_main", title: ml("Basics"), columns: 2, blocks: [
        { id: "blk_title", kind: "field", fieldKey: "title", span: 1, modes: ALL, columns: [] },
        { id: "blk_note", kind: "field", fieldKey: "note", span: 1, modes: ALL, columns: [] },
        ...filler,
      ] }] },
      { id: "tab_lines", title: ml("Lines"), sections: [{ id: "sec_lines", title: {}, columns: 1, blocks: [
        { id: "blk_short", kind: "text", text: ml("Short tab"), span: 1, modes: ALL, columns: [] },
      ] }] },
    ],
  };
}

const record = { id: 60, entityId: A, statusId: null, valuesJson: { title: "Order 60", note: "Rush" }, version: 2, archivedAt: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" };

async function setup(page: Page, opts: { presentation?: "modal" | "side" | "fullscreen"; lang?: "en" | "he" } = {}) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-card-presentation"));
  const lang = opts.lang ?? "en";
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/me") return reply({
      id: 1, email: "pres@example.test", firstName: "Pres", roleId: 1, roleIds: [1], language: lang, direction: lang === "he" ? "rtl" : "ltr", isActive: true,
      permissions: { superAdmin: true, pageIds: [PAGE_A, PAGE_B], admin: { cardTemplates: true }, records: {
        [A]: { view: true, create: true, update: true, delete: false, scope: "all" },
        [B]: { view: true, create: true, update: true, delete: false, scope: "all" },
      } },
    });
    if (path === "/api/pages") return reply(pages);
    if (path === "/api/entities") return reply(entities);
    if (path === `/api/entities/${A}`) return reply(entities[0]);
    if (path === `/api/entities/${B}`) return reply(entities[1]);
    if (path === "/api/settings") return reply({ defaultLanguage: "en", timeZone: "UTC" });
    if (path === `/api/entities/${A}/fields`) return reply(fieldsA);
    if (path === `/api/entities/${B}/fields`) return reply(fieldsB);
    if (path.endsWith("/relations")) return reply([{ id: REL, sourceEntityId: A, targetEntityId: B }]);
    if (path.includes("/collaboration/")) return route.abort();
    if (path === "/api/card-templates/resolve") {
      return reply({ template: { id: 1, name: "Order card", entityId: A, pageId: null, state: "published", revision: 1, layout: layout(opts.presentation) } });
    }
    if (path === `/api/entities/${A}/records/query`) return reply({ data: [record], total: 1, numericTotals: {} });
    if (path === `/api/entities/${A}/related-values`) return reply({ columns: [], values: [] });
    if (path.endsWith("/statuses") || path.endsWith("/views")) return reply([]);
    return reply([]);
  });
  return errors;
}

async function openView(page: Page) {
  await page.goto("/pres-orders");
  const viewBtn = page.locator('[data-testid="record-view-button"][data-record-id="60"]');
  await expect(viewBtn).toBeVisible();
  await viewBtn.click();
  const dlg = page.getByTestId("record-dialog");
  await expect(dlg.getByTestId("card-layout")).toBeVisible();
  return dlg;
}

test("card user picker: enabled options show pointer and still select", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/entities/${A}/fields`, r => r.fulfill({ json: [field(10, A, "client", "user")] }));
  await page.route("**/api/card-templates/resolve", r => r.fulfill({ json: { template: null } }));
  await page.route("**/api/users/options**", r => r.fulfill({ json: [{ id: 7, name: "Client example", firstName: "Client", lastName: "example" }] }));
  await page.goto("/pres-orders");
  await page.getByRole("button", { name: /^(Добавить запись|Add record)$/ }).click();
  const input = page.getByTestId("record-dialog").getByTestId("form-field-client");
  await input.getByRole("combobox").click();
  const option = page.getByRole("option").filter({ hasText: "Client example" });
  await expect(option).toHaveAttribute("data-disabled", "false");
  await option.hover();
  await expect(option).toHaveCSS("cursor", "pointer");
  await option.click();
  await expect(input).toContainText("Client example");
});

test("large table: opening phase benchmark", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, { presentation: "modal" });
  const extraFields = Array.from({ length: 24 }, (_, i) => field(100 + i, A, `column_${i}`, "text"));
  await page.route(`**/api/entities/${A}/fields`, r => r.fulfill({ json: [...fieldsA, ...extraFields] }));
  const rows = Array.from({ length: 200 }, (_, i) => ({ ...record, id: 1000 + i,
    valuesJson: { ...record.valuesJson, title: `Order ${i}`, ...Object.fromEntries(extraFields.map(f => [f.fieldKey, `Value ${i}`])) },
  }));
  await page.route(`**/api/entities/${A}/records/query`, r => r.fulfill({ json: { data: rows, total: 200, numericTotals: {} } }));
  await page.goto("/pres-orders");
  await expect(page.locator('[data-testid="record-view-button"]')).toHaveCount(200);
  await expect(page.locator(".erp-table-scroll")).toHaveCSS("--removed-body-scroll-bar-size", "0px");
  const profiler = process.env.CARD_PROFILE ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
  const samples = await page.evaluate(readFileSync("scripts/measure-card-opening.browser.js", "utf8"));
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    console.log("CARD_PROFILE", JSON.stringify([...profile.nodes].sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)).slice(0, 35).map(n => ({
      hits: n.hitCount, fn: n.callFrame.functionName, url: n.callFrame.url.split("/").pop(), line: n.callFrame.lineNumber,
    }))));
    await profiler.detach();
  }
  console.log("LARGE_TABLE_CARD_PHASES", JSON.stringify(samples));
  expect(samples).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("isolated draft: create, view/edit, CAS conflict and retry preserve current values", async ({ page }) => {
  const errors = await setup(page, { presentation: "modal" });
  const creates: any[] = [];
  const updates: any[] = [];
  await page.route(`**/api/entities/${A}/records`, async route => {
    expect(route.request().method()).toBe("POST");
    creates.push(route.request().postDataJSON());
    await route.fulfill({ json: { ...record, id: 61 } });
  });
  await page.route("**/api/records/60", async route => {
    expect(route.request().method()).toBe("PUT");
    updates.push(route.request().postDataJSON());
    await route.fulfill(updates.length === 1
      ? { status: 409, json: { error: "Conflict", currentVersion: 3 } }
      : { json: { ...record, version: 3 } });
  });
  await page.goto("/pres-orders");
  const dlg = page.getByTestId("record-dialog");
  await page.getByRole("button", { name: /^(Добавить запись|Add record)$/ }).click();
  const title = dlg.getByTestId("form-field-title").locator("input");
  await title.fill("New draft");
  await dlg.getByTestId("record-dialog-save").click();
  await expect(dlg).toHaveCount(0);
  expect(creates[0].valuesJson.title).toBe("New draft");
  await page.getByTestId("record-view-button").click();
  await expect(dlg.getByTestId("record-dialog-save")).toHaveCount(0);
  await dlg.getByTestId("record-dialog-to-edit").click();
  await title.fill("Edited draft");
  await dlg.getByTestId("record-dialog-save").click();
  await expect.poll(() => updates.length).toBe(1);
  await expect(title).toHaveValue("Edited draft");
  expect(updates[0].expectedVersion).toBe(2);
  await expect(dlg.getByTestId("record-dialog-save")).toBeEnabled();
  await dlg.getByTestId("record-dialog-save").click();
  await expect(dlg).toHaveCount(0);
  expect(updates[1].valuesJson.title).toBe("Edited draft");
  expect(updates[1].expectedVersion).toBe(2); // never silently adopts a conflicting version
  await page.getByRole("button", { name: /^(Добавить запись|Add record)$/ }).click();
  await expect(title).toHaveValue("");
  await dlg.getByTestId("button-card-close").click();
  expect(errors).toEqual([]);
});

const box = async (page: Page, testId: string) => {
  // Wait for the open animation and the async card resolve to settle.
  let prev = "";
  await expect.poll(async () => {
    const cur = JSON.stringify(await page.getByTestId(testId).boundingBox());
    const stable = cur === prev; prev = cur; return stable;
  }, { intervals: [150, 150, 150, 300, 500] }).toBe(true);
  const b = await page.getByTestId(testId).boundingBox();
  expect(b).toBeTruthy();
  return b!;
};
const near = (a: number, b: number, tol = 2) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

test.describe("card presentation", () => {
  test("kanban view and edit wait for the template without flashing a legacy window", async ({ page }) => {
    await setup(page, { presentation: "side" });
    await page.route("**/api/entities/*/main-views", route => route.fulfill({json: [{
      id: 99, entityId: A, nameJson: ml("Board"), isDefault: true, sortOrder: 0,
      configJson: { viewType: "kanban", kanban: { titleField: "title", fields: [] } },
    }]}));
    let release!: () => void;
    let wait = new Promise<void>(r => { release = r; });
    await page.route("**/api/card-templates/resolve", async route => {
      await wait;
      await route.fulfill({json: {template: {id: 1, layout: layout("side")}}});
    });
    await page.goto("/pres-orders");
    await page.locator('[data-testid^="button-view-kanban-"]').first().click();
    const dlg = page.getByTestId("record-dialog");
    await expect(page.getByTestId("card-opening")).toBeVisible();
    await expect(dlg).toHaveCSS("opacity", "0");
    release();
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    await expect(dlg).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("dialog-kanban-detail")).toHaveCount(0);
    wait = new Promise<void>(r => { release = r; });
    await dlg.getByTestId("record-dialog-to-edit").click();
    await expect(page.getByTestId("card-opening")).toBeVisible();
    await expect(dlg).toHaveCSS("opacity", "0");
    release();
    await expect(dlg).toHaveCSS("opacity", "1");
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    await page.keyboard.press("Escape");
    wait = new Promise<void>(r => { release = r; });
    await page.locator('[data-testid^="button-open-kanban-"]').first().click();
    await expect(page.getByTestId("card-opening")).toBeVisible();
    await expect(dlg).toHaveCSS("opacity", "0");
    release();
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    await expect(dlg).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    wait = new Promise<void>(r => { release = r; });
    await page.getByRole("button", { name: /^(Добавить запись|Add record)$/ }).click();
    await expect(page.getByTestId("card-opening")).toBeVisible();
    await expect(dlg).toHaveCSS("opacity", "0");
    release();
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    await expect(dlg).toHaveCSS("opacity", "1");
  });
  test.use({ viewport: { width: 1280, height: 800 } });

  test("legacy layout without presentation opens as a centered 85dvh modal", async ({ page }) => {
    const errors = await setup(page);
    const dlg = await openView(page);
    await expect(dlg).toHaveAttribute("data-card-presentation", "modal");
    await expect(dlg).toHaveAttribute("data-card-default", "modal");
    const b = await box(page, "record-dialog");
    near(b.height, 800 * 0.85);
    near(b.x + b.width / 2, 640);
    near(b.y + b.height / 2, 400);
    expect(errors).toEqual([]);
  });

  test("side panel: full height, wide, anchored right in LTR; fullscreen fills the viewport", async ({ page }) => {
    await setup(page, { presentation: "side" });
    let dlg = await openView(page);
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    let b = await box(page, "record-dialog");
    near(b.y, 0); near(b.height, 800); near(b.x + b.width, 1280);
    expect(b.width).toBeGreaterThanOrEqual(900);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await setup(page, { presentation: "fullscreen" });
    dlg = await openView(page);
    await expect(dlg).toHaveAttribute("data-card-presentation", "fullscreen");
    b = await box(page, "record-dialog");
    near(b.x, 0); near(b.y, 0); near(b.width, 1280); near(b.height, 800);
  });

  test("tab switching never resizes the window; header, tabs and footer stay visible while the body scrolls", async ({ page }) => {
    await setup(page, { presentation: "modal" });
    const dlg = await openView(page);
    const body = dlg.getByTestId("card-shell-body");
    await expect(body).toHaveCSS("scrollbar-gutter", "stable");
    await expect(body).toHaveCSS("overflow-y", "auto");
    const before = await box(page, "record-dialog");
    await dlg.getByTestId("card-tab-tab_lines").click();
    await expect(dlg.getByTestId("card-text-blk_short")).toBeVisible();
    const afterShort = await box(page, "record-dialog");
    await dlg.getByTestId("card-tab-tab_main").click();
    const afterLong = await box(page, "record-dialog");
    for (const b of [afterShort, afterLong]) { expect(b.width).toBe(before.width); expect(b.height).toBe(before.height); expect(b.x).toBe(before.x); expect(b.y).toBe(before.y); }
    // Long tab overflows: scroll the body to the end; chrome stays in view.
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(dlg.getByTestId("card-text-blk_fill_39")).toBeInViewport();
    await expect(dlg.getByTestId("card-shell-header")).toBeInViewport();
    await expect(dlg.getByTestId("card-shell-footer")).toBeInViewport();
    await expect(dlg.getByTestId("record-dialog-close")).toBeInViewport();
    await expect(dlg.getByTestId("card-tab-tab_lines")).toBeInViewport();
  });

  test("RTL (he): side panel anchors to the left edge", async ({ page }) => {
    await setup(page, { presentation: "side", lang: "he" });
    const dlg = await openView(page);
    await expect(dlg).toHaveAttribute("dir", "rtl");
    const b = await box(page, "record-dialog");
    near(b.x, 0); near(b.y, 0); near(b.height, 800);
    expect(b.x + b.width).toBeLessThan(1280);
  });

  test("mobile: every presentation opens full screen and the expand button is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const presentation of ["modal", "side"] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await setup(page, { presentation });
      await openView(page);
      const b = await box(page, "record-dialog");
      near(b.x, 0); near(b.y, 0); near(b.width, 390); near(b.height, 844);
      await expect(page.getByTestId("button-card-expand")).toBeHidden();
      await expect(page.getByTestId("record-dialog-close")).toBeInViewport();
    }
  });

  test("expand/restore keeps typed values and the active tab (same mounted tree)", async ({ page }) => {
    const errors = await setup(page, { presentation: "side" });
    const dlg = await openView(page);
    await dlg.getByTestId("record-dialog-to-edit").click();
    const title = dlg.getByTestId("form-field-title").locator("input");
    await expect(title).toBeEnabled();
    await title.fill("Order 60 typed");
    await dlg.getByTestId("card-tab-tab_lines").click();
    const expand = dlg.getByTestId("button-card-expand");
    await expand.click();
    await expect(dlg).toHaveAttribute("data-card-presentation", "fullscreen");
    await expect(expand).toHaveAttribute("aria-pressed", "true");
    const full = await box(page, "record-dialog");
    near(full.width, 1280); near(full.height, 800);
    await expect(dlg.getByTestId("card-tab-tab_lines")).toHaveAttribute("data-state", "active");
    await expect(dlg.getByTestId("card-text-blk_short")).toBeVisible();
    await expand.click();
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    await expect(dlg.getByTestId("card-tab-tab_lines")).toHaveAttribute("data-state", "active");
    await dlg.getByTestId("card-tab-tab_main").click();
    await expect(title).toHaveValue("Order 60 typed");
    expect(errors).toEqual([]);
  });

  test("fullscreen default restores to a modal", async ({ page }) => {
    await setup(page, { presentation: "fullscreen" });
    const dlg = await openView(page);
    await dlg.getByTestId("button-card-expand").click();
    await expect(dlg).toHaveAttribute("data-card-presentation", "modal");
    const b = await box(page, "record-dialog");
    near(b.height, 800 * 0.85);
    await dlg.getByTestId("button-card-expand").click();
    await expect(dlg).toHaveAttribute("data-card-presentation", "fullscreen");
  });

  test("builder: presentation selector is saved with the layout and drives the preview", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("erp_token", "intercepted-card-presentation"));
    const draft = { id: 9, name: "Pres card", entityId: A, pageId: null, state: "draft", revision: 1, layout: layout() };
    const saved: any[] = [];
    await setup(page);
    await page.route("**/api/card-templates**", async route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/card-templates") return reply([draft]);
      if (path === "/api/card-templates/9" && route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        saved.push(body);
        return reply({ ...draft, ...body, revision: 2 });
      }
      return reply([]);
    });
    await page.goto("/admin/card-templates/9");
    await expect(page.getByTestId("button-presentation-modal")).toHaveAttribute("aria-checked", "true");
    for (const width of [1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      const inspector = page.getByTestId("card-inspector");
      await expect.poll(() => inspector.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const overflowing = await inspector.evaluate(el => {
        const panel = el.querySelector("fieldset")!.parentElement!.getBoundingClientRect();
        return [...el.querySelectorAll("fieldset button, fieldset input, fieldset select")].filter(child => {
          const rect = child.getBoundingClientRect();
          return rect.width > 0 && (rect.left < panel.left || rect.right > panel.right);
        }).length;
      });
      expect(overflowing).toBe(0);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("button-presentation-side").click();
    await expect(page.getByTestId("button-presentation-side")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("button-save-draft").click();
    await expect.poll(() => saved.length).toBeGreaterThan(0);
    expect(saved[0].layout.presentation).toBe("side");
    await page.getByTestId("button-card-preview").click();
    const dlg = page.getByTestId("dialog-card-preview");
    await expect(dlg).toHaveAttribute("data-card-presentation", "side");
    const b = await box(page, "dialog-card-preview");
    near(b.height, 800); near(b.x + b.width, 1280);
  });
});
