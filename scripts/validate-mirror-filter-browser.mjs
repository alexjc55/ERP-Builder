// UI fixtures only; no ERP data is changed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true,
  executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim() });
try {
  for (const entityAccess of [false, true]) {
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem("erp_token", "browser-fixture"));
    const requests = [];
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const own = { view: true, create: false, update: false, delete: false, scope: "own", scopeFieldKeys: ["owner"] };
    const entity = { id: 1, pageId: 10, entityKey: "fixture", nameJson: { ru: "Изделия" }, isActive: true };
    const mirror = { id: 2, nameJson: { ru: "Производство" }, path: "/production-fixture", mirrorEntityId: 1,
      isActive: true, isSystem: false, children: [], sortOrder: 0, icon: "file" };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      let body = [];
      if (path.endsWith("/auth/me")) body = { id: 1, roleId: 1, roleIds: [1], firstName: "Fixture", lastName: "", language: "ru", direction: "ltr",
        permissions: { superAdmin: false, admin: {}, records: { "mirror:2": own, ...(entityAccess ? { "1": own } : {}) }, pageIds: [2] } };
      else if (path.endsWith("/pages")) body = [mirror];
      else if (path.endsWith("/entities")) body = [entity];
      else if (path.endsWith("/entities/1")) body = entity;
      else if (path.endsWith("/pages/2")) body = mirror;
      else if (path.endsWith("/settings")) body = { appName: "Fixture" };
      else if (path.endsWith("/records/query")) body = { data: [], total: 0, page: 1, pageSize: 50 };
      else if (path.endsWith("/related-values")) body = { columns: [], rows: [] };
      else if (path.includes("/security/")) body = {};
      else if (path.endsWith("/collaboration/pages/2/stream")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": fixture\n\n" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const filterRequest = page.waitForRequest(r => new URL(r.url()).pathname.endsWith("/pages/2/custom-filters"));
    await page.goto("http://localhost:80/production-fixture");
    await filterRequest;
    await page.reload();
    await page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/pages/2/custom-filters"));
    assert.ok(!requests.some(p => p.endsWith("/entities/1/custom-filters")), "Mirror never probes entity definitions even with cached/entity permissions");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: opening/reloading own-scope mirror uses page filter discovery, not entity-only endpoint.");
} finally { await browser.close(); }
