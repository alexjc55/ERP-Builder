import { test, expect } from "@playwright/test";

async function setup(page: import("@playwright/test").Page, superAdmin = true) {
  let reviewed = false;
  const queries: Record<string, unknown>[] = [];
  const item = {
    id: 41, createdAt: "2026-10-06T10:00:00Z", requestId: "request-fixture",
    action: "user.create", outcome: "success", severity: "critical", isAlert: true,
    actorUserId: 1, targetUserId: 12, authSource: "session", sessionRef: "session-fixture",
    peerIp: "127.0.0.1", clientIp: "127.0.0.1", ipSource: "socket", method: "POST",
    route: "/users", statusCode: 200, detailsJson: { requestedRoleIds: [1] },
  };
  await page.addInitScript(() => localStorage.setItem("erp_token", "ui-test-only"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: {
      id: 1, roleId: 1, roleIds: [1], firstName: "Test", lastName: "Admin", language: "ru",
      permissions: { superAdmin, admin: { events: true }, records: {}, pageIds: [] },
    } });
    if (path.endsWith("/security/summary")) return route.fulfill({ json: {
      unreviewedAlerts: reviewed ? 0 : 1, failedLogins24h: 5, deniedRequests24h: 1,
      criticalChanges24h: 1, proxyAttribution: "socket-only",
    } });
    if (path.endsWith("/security/events/query")) {
      queries.push(route.request().postDataJSON());
      return route.fulfill({ json: { data: [{ ...item, reviewedAt: reviewed ? "2026-10-06T12:00:00Z" : null, reviewedBy: reviewed ? 1 : null }], total: 1 } });
    }
    if (path.endsWith("/security/events/41/review")) {
      reviewed = true; return route.fulfill({ json: { success: true } });
    }
    if (path.endsWith("/settings")) return route.fulfill({ json: { appNameJson: { ru: "ERP" }, defaultLanguage: "ru" } });
    if (path.endsWith("/events")) return route.fulfill({ json: { data: [], total: 0 } });
    if (path.endsWith("/admin/operational-alerts")) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  await page.goto("/admin/events?tab=security");
  return queries;
}

test("super-admin can trace a session, filter evidence and acknowledge without deleting it", async ({ page }) => {
  const queries = await setup(page);
  await expect(page.getByTestId("security-alert-banner")).toBeVisible();
  await expect(page.getByTestId("row-security-event-41")).toBeVisible();
  await page.getByTestId("button-security-inspect-41").click();
  await expect(page.getByTestId("dialog-security-event")).toBeVisible();
  await page.getByTestId("button-security-follow-session").click();
  await expect.poll(() => queries.some((q) => q.sessionRef === "session-fixture")).toBe(true);
  await page.getByTestId("button-security-ack-41").click();
  await expect(page.getByTestId("security-alert-banner")).not.toBeVisible();
  await expect(page.getByTestId("row-security-event-41")).toBeVisible();
  await page.screenshot({ path: "/tmp/security-audit-desktop.png" });
});

test("ordinary admin cannot see security evidence", async ({ page }) => {
  const queries = await setup(page, false);
  await expect(page.getByTestId("tab-events-security")).not.toBeVisible();
  await expect(page.getByTestId("security-alert-banner")).not.toBeVisible();
  expect(queries).toHaveLength(0);
});

test("mobile filters are usable and invalid IDs do not reach the API", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const queries = await setup(page);
  await expect(page.getByTestId("row-security-event-41")).toBeVisible();
  const count = queries.length;
  await page.getByTestId("input-security-actorUserId").fill("-1");
  await page.getByTestId("button-security-apply").click();
  await expect(page.getByTestId("status-security-filter-invalid")).toBeVisible();
  expect(queries).toHaveLength(count);
  await page.screenshot({ path: "/tmp/security-audit-mobile.png", fullPage: true });
});
