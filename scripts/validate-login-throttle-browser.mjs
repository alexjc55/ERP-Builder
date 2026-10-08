// Browser-only API mocks; does not send credentials to the ERP.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true,
  executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim() });
try {
  const page = await browser.newPage();
  let attempts = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/login")) {
      attempts++;
      return route.fulfill({ status: 429, contentType: "application/json",
        headers: { "Retry-After": "3" }, body: JSON.stringify({ error: "Too many login attempts", retryAfterSeconds: 3 }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: path.includes("translations") ? "[]" : "{}" });
  });
  await page.goto("http://localhost:80/login");
  await page.locator('input[type="email"]').fill("fixture@example.invalid");
  await page.locator('input[type="password"]').fill("browser-fixture");
  const submit = page.locator('button[type="submit"]');
  await submit.click();
  await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.disabled === true);
  await page.waitForTimeout(700);
  assert.match(await submit.innerText(), /[123]/);
  assert.equal(attempts, 1);
  await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.disabled === false);
  assert.equal(attempts, 1, "Countdown must not automatically retry credentials");
  console.log("PASS: 429 shows countdown, disables submission and permits manual retry after expiry.");
} finally { await browser.close(); }
