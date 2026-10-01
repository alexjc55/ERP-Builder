import { expect, test } from "@playwright/test";

for (const language of ["ru", "he"]) {
  test(`widget headings stay top-aligned with optional secondary content (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("erp_token", "mock-layout"));
    const widgets = [
      { id: 1, titleJson: { ru: "Активность пользователей", he: "פעילות משתמשים" }, widgetType: "online_users", onlineUsers: [] },
      { id: 2, titleJson: { ru: "Заказов в работе", he: "הזמנות בעבודה" }, widgetType: "metric", colorStyle: "border",
        secondaryValue: { metricKey: "total", captionJson: { ru: "На сумму:", he: "בסכום:" }, format: "currency" } },
      { id: 3, titleJson: { ru: "Для проверки", he: "לבדיקה" }, widgetType: "metric", colorStyle: "border" },
    ].map(w => ({ pageId: 987650, icon: "", color: "bg-blue-600", gridW: 1, gridH: 1, format: "number", metrics: { count: 49, total: 537098 }, ...w }));
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/me") return reply({ id: 1, roleId: 1, roleIds: [1], firstName: "Tester", language, isActive: true,
        permissions: { superAdmin: true, pageIds: [987650], admin: {}, records: {} } });
      if (path === "/api/pages") return reply([{ id: 987650, path: "/heading-fixture", nameJson: { ru: "Панель управления", he: "לוח בקרה" }, isActive: true, isDashboard: true }]);
      if (path === "/api/settings") return reply({ defaultLanguage: language, currencySymbol: "₪", timeZone: "UTC" });
      if (path.endsWith("/dashboard/data")) return reply(widgets);
      if (path.includes("/collaboration/")) return route.abort();
      return reply([]);
    });
    await page.goto("/heading-fixture");
    const headings = widgets.map(w => page.getByText(w.titleJson[language as "ru" | "he"], { exact: true }));
    for (const heading of headings) await expect(heading).toBeVisible();
    const positions = await Promise.all(headings.map(h => h.evaluate(el => {
      const card = el.closest(".rounded-xl")!;
      const style = getComputedStyle(el);
      return { y: el.getBoundingClientRect().y, inset: el.getBoundingClientRect().y - card.getBoundingClientRect().y,
        size: style.fontSize, weight: style.fontWeight };
    })));
    expect(Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y))).toBeLessThanOrEqual(1);
    for (const p of positions) {
      expect(p.inset).toBeGreaterThanOrEqual(16);
      expect(p.inset).toBeLessThanOrEqual(18);
      expect(p.size).toBe("16px");
      expect(p.weight).toBe("600");
    }
    const secondary = page.getByTestId("widget-secondary-value");
    expect(await secondary.evaluate(el => getComputedStyle(el).fontSize)).toBe("14px");
    await page.screenshot({ path: test.info().outputPath("aligned-headings.png") });
    await page.setViewportSize({ width: 402, height: 874 });
    for (const heading of headings) {
      expect(await heading.evaluate(el => {
        const card = el.closest(".rounded-xl")!;
        return el.getBoundingClientRect().y - card.getBoundingClientRect().y;
      })).toBeLessThanOrEqual(18);
    }
    expect(await secondary.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}