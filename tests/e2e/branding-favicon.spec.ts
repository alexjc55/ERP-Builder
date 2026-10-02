import { expect, test } from "@playwright/test";

test("login favicon uses public branding and resets after logo removal", async ({ page }) => {
  let logo: string | null = "/local/branding/test-logo.png";
  let version = "2026-10-02T00:00:00.000Z";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings") {
      expect(route.request().headers().authorization).toBeUndefined();
      return route.fulfill({ json: {
        appNameJson: { en: "Test brand" }, subtitleJson: {}, defaultLanguage: "en",
        logoObjectPath: logo, updatedAt: version,
      } });
    }
    if (path === "/api/storage/branding-logo") return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="gold"/></svg>',
    });
    return route.fulfill({ json: [] });
  });
  await page.goto("/login");
  const icon = page.locator('link[rel="icon"]');
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(icon).toHaveAttribute("href", `/api/storage/branding-logo?v=${encodeURIComponent(version)}`);
  await expect(icon).not.toHaveAttribute("type", "image/svg+xml");
  expect(await page.evaluate(() => localStorage.getItem("erp_token"))).toBeNull();

  version = "2026-10-03T00:00:00.000Z";
  await page.reload();
  await expect(icon).toHaveAttribute("href", `/api/storage/branding-logo?v=${encodeURIComponent(version)}`);
  logo = null;
  await page.reload();
  await expect(icon).toHaveAttribute("href", "/favicon.svg");
  await expect(icon).toHaveAttribute("type", "image/svg+xml");
  expect(errors).toEqual([]);
});

test("actual unauthenticated login favicon points to a publicly readable image", async ({ page }) => {
  await page.goto("/login");
  const settingsResponse = await page.request.get("/api/settings");
  expect(settingsResponse.ok()).toBe(true);
  const settings = await settingsResponse.json();
  const expectedPath = settings.logoObjectPath
    ? `/api/storage/branding-logo?v=${encodeURIComponent(settings.updatedAt)}`
    : "/favicon.svg";
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", expectedPath);
  const image = await page.request.get(expectedPath);
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toMatch(/^image\//);
  expect((await image.body()).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem("erp_token"))).toBeNull();
});