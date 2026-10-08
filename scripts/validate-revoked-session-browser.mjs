// Browser-only API mocks; never changes accounts or bypasses server auth.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
});
const page = await browser.newPage();
const calls = [];
let release;
const pending = new Promise((resolve) => { release = resolve; });
await page.addInitScript(() => localStorage.setItem("erp_token", "revoked-browser-test-not-a-real-key"));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  calls.push(path);
  if (path === "/api/auth/me") {
    await pending;
    await route.fulfill({ status: 401, contentType: "application/json",
      body: '{"error":"Session revoked or account inactive"}' });
    return;
  }
  await route.fulfill({ status: 200, contentType: "application/json",
    body: path.includes("translations") ? "[]" : "{}" });
});
try {
  await page.goto("http://localhost:80/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const allowed = (path) => path === "/api/auth/me" ||
    path.includes("translations") || path.includes("settings");
  assert.ok(calls.includes("/api/auth/me"), "Session check must start");
  assert.ok(calls.every(allowed), `Protected requests before verification: ${calls}`);
  release();
  await page.waitForURL("**/login");
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => localStorage.getItem("erp_token")), null);
  assert.ok(calls.every(allowed), `Protected requests after revocation: ${calls}`);
  assert.equal(calls.filter((path) => path === "/api/auth/me").length, 1);
  console.log("PASS: session checked once, protected readers blocked, revoked token cleared, login displayed.");
} finally {
  release();
  await browser.close();
}
