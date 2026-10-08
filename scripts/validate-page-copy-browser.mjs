// UI fixture only: requests are intercepted, no production or local ERP data is changed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true,
  executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim() });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("erp_token", "browser-fixture"));
  const basic = { descriptionJson: {}, icon: "file", isActive: true, sortOrder: 0, children: [], isSystem: false };
  const source = { ...basic, id: 2, nameJson: { ru: "Зеркальная тест" }, mirrorEntityId: 1, path: "/mirror" };
  const pages = [
    { ...basic, id: 1, nameJson: { ru: "Основная тест" }, path: "/main" },
    source,
    { ...basic, id: 3, nameJson: { ru: "Системная тест" }, path: "/admin/system", isSystem: true },
  ];
  let copies = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith("/auth/me")) body = { id: 1, firstName: "Fixture", lastName: "", language: "ru", direction: "ltr", permissions: { superAdmin: true, admin: {}, records: {}, pageIds: [] } };
    else if (path.endsWith("/pages/2/duplicate")) {
      copies++;
      const copy = { ...source, id: 4, path: "/mirror-copy", nameJson: { ru: "Зеркальная тест (копия)" } };
      pages.push(copy);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(copy) });
    } else if (path.endsWith("/pages")) body = pages;
    else if (path.endsWith("/entities")) body = [{ id: 1, pageId: 1, entityKey: "fixture", nameJson: { ru: "Тест" } }];
    else if (path.endsWith("/settings")) body = { appName: "Fixture" };
    else if (path.includes("/security/")) body = {};
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("http://localhost:80/admin/pages");
  const copyButtons = page.getByRole("button", { name: "Дублировать страницу", exact: true });
  await copyButtons.first().waitFor();
  assert.equal(await copyButtons.count(), 1, "Main/system pages must not expose copying");
  await copyButtons.first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Дублировать страницу", exact: true }).click();
  await page.getByText("Копия страницы создана", { exact: true }).first().waitFor();
  assert.equal(copies, 1);
  // Opening the edit dialog intentionally makes the background aria-hidden.
  await page.locator("tr").filter({ hasText: "Зеркальная тест (копия)" }).waitFor();
  await page.getByRole("dialog").waitFor();
  assert.ok((await page.locator('input').evaluateAll(inputs => inputs.map(i => i.value))).includes("/mirror-copy"));
  console.log("PASS: protected rows, confirmation, POST, refreshed list and copy edit form.");
} finally { await browser.close(); }
