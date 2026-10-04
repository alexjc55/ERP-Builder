import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { db, pool, rolesTable, usersTable } from "@workspace/db";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";

// Opt-in, read-only benchmark of an existing published development card.
// Never creates/saves records; never prints credentials or record contents.
test("measure live development card request and first rendered form separately", async ({ page, request }) => {
  test.skip(!process.env.CARD_PERF_DEV_FINGERPRINT, "Requires independently verified development fingerprint");
  test.setTimeout(120_000);
  try {
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.hostname).toBe("helium");
    expect(url.pathname).toBe("/heliumdb");
    const fingerprint = await db.execute(sql`SELECT md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) AS fingerprint FROM entities`);
    expect(fingerprint.rows[0]?.fingerprint).toBe(process.env.CARD_PERF_DEV_FINGERPRINT);
    const [user] = await db.select({ id: usersTable.id, roleId: usersTable.roleId }).from(usersTable)
      .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
      .where(sql`${usersTable.isActive}=true AND ${rolesTable.permissionsJson}->>'superAdmin'='true'`).limit(1);
    const scope = await db.execute(sql`
      SELECT c.entity_id AS "entityId", p.id AS "pageId", p.path
      FROM card_templates c JOIN entities e ON e.id=c.entity_id
      JOIN pages p ON p.id=COALESCE(c.page_id,e.page_id)
      WHERE c.state='published' AND e.is_active AND p.is_active
      ORDER BY c.id LIMIT 1`);
    expect(scope.rows.length, "Needs a published development card").toBe(1);
    const { entityId, pageId, path } = scope.rows[0];
    const token = signToken({ userId: user.id, roleId: user.roleId });
    const apiTimes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      const response = await request.post("/api/card-templates/resolve", {
        headers: { Authorization: `Bearer ${token}` }, data: { entityId, pageId, mode: "create" },
      });
      expect(response.ok()).toBe(true);
      expect((await response.json()).template).toBeTruthy();
      apiTimes.push(Math.round(performance.now() - start));
    }
    await page.addInitScript(t => localStorage.setItem("erp_token", t), token);
    await page.goto(String(path));
    await expect(page.getByRole("button", { name: /^(Добавить запись|Add record)$/ })).toBeVisible();
    const samples = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await page.evaluate(async () => {
        performance.clearResourceTimings();
        const button = [...document.querySelectorAll("button")].find(b => /^(Добавить запись|Add record)$/.test(b.textContent?.trim() ?? ""))!;
        const start = performance.now();
        button.click();
        return await new Promise(resolve => {
          const check = () => {
            if (performance.now() - start > 15_000) { resolve({ error: "form timeout" }); return; }
            const dialog = document.querySelector('[data-testid="record-dialog"]');
            if (dialog?.querySelector('[data-testid="card-layout"]') && getComputedStyle(dialog).opacity === "1") {
              const req = performance.getEntriesByType("resource").find(r => r.name.includes("/card-templates/resolve")) as PerformanceResourceTiming;
              resolve({
                clickToFormMs: Math.round(performance.now() - start),
                requestMs: req ? Math.round(req.responseEnd - req.startTime) : null,
                afterResponseMs: req ? Math.round(performance.now() - req.responseEnd) : null,
              });
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
      }));
      expect(samples.at(-1)).not.toHaveProperty("error");
      await page.getByTestId("button-card-close").click();
      await expect(page.getByTestId("record-dialog")).toHaveCount(0);
    }
    console.log(JSON.stringify({ label: process.env.CARD_PERF_LABEL ?? "sample", apiMs: apiTimes, browser: samples }));
  } finally {
    await pool.end();
  }
});