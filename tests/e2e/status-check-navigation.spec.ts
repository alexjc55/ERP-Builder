import { expect, test, type Page } from "@playwright/test";

const firstId = 99101;
const secondId = 99102;
const editor = (id: number) => `/admin/entities/${id}/statuses`;
const queryPath = (id: number) => `/api/entities/${id}/records/query`;
type Outcome = "records" | "empty" | "error";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function installFixture(page: Page, outcome: Outcome) {
  const old = barrier();
  const current = barrier();
  const errors: string[] = [];
  const writes: Array<{ path: string; body: unknown }> = [];
  const entities = [firstId, secondId].map(id => ({
    id, entityKey: `entity_${id}`, nameJson: { en: `Entity ${id}` },
    allowNoStatus: true, isActive: true,
  }));
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("erp_token", "mock-status-editor"));
  // No request is continued to the real API, including unexpected mutations.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path === queryPath(firstId)) {
      await old.promise;
      return outcome === "error" ? reply({ error: "Old check failed" }, 503)
        : reply({ data: outcome === "records" ? [{ id: 1 }] : [], total: outcome === "records" ? 1 : 0 });
    }
    if (path === queryPath(secondId)) {
      await current.promise;
      return reply({ data: [], total: 0 });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      writes.push({ path, body: request.postDataJSON() });
      const entity = entities.find(item => path === `/api/entities/${item.id}`);
      if (entity && request.method() === "PUT") {
        Object.assign(entity, request.postDataJSON());
        return reply(entity);
      }
      return reply({ error: "Unexpected mock write" }, 400);
    }
    if (path === "/api/auth/me") return reply({
      id: 1, roleId: 1, roleIds: [1], firstName: "Fixture", language: "en", direction: "ltr",
      isActive: true, permissions: { superAdmin: false, pageIds: [], records: {}, admin: { entities: true } },
    });
    if (path === "/api/settings") return reply({ defaultLanguage: "en" });
    if (path === "/api/entities") return reply(entities);
    const entity = entities.find(item => path === `/api/entities/${item.id}`);
    return reply(entity ?? []);
  });
  return { old, current, errors, writes };
}

async function navigateWithinApp(page: Page, path: string) {
  // Client-side navigation preserves the document and pending fetch, unlike goto.
  await page.evaluate(path => {
    history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await expect(page).toHaveURL(path);
}

for (const navigation of ["other-entity", "unmount"] as const) {
  for (const outcome of ["records", "empty", "error"] as const) {
    test(`late status check ${outcome} is ignored after ${navigation}`, async ({ page }) => {
      const fixture = await installFixture(page, outcome);
      try {
        await page.goto(editor(firstId));
        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        const toggle = page.locator("#allow-no-status");
        await expect(toggle).toBeChecked();
        const oldRequest = page.waitForRequest(request => new URL(request.url()).pathname === queryPath(firstId));
        await toggle.click();
        expect((await oldRequest).postDataJSON()).toMatchObject({ statusIsNull: true, pageSize: 1 });
        await expect(toggle).toBeDisabled();

        await navigateWithinApp(page, navigation === "unmount" ? "/admin/entities" : editor(secondId));
        if (navigation === "unmount") await expect(toggle).toHaveCount(0);
        else {
          await expect(toggle).toBeEnabled();
          const newRequest = page.waitForRequest(request => new URL(request.url()).pathname === queryPath(secondId));
          await toggle.click();
          await newRequest;
          await expect(toggle).toBeDisabled();
        }
        const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === queryPath(firstId));
        fixture.old.release();
        await (await oldResponse).finished();
        // Allow the old fetch promise and React effects to settle; inspect both
        // forbidden side effects and the newer request's still-pending state.
        await page.waitForTimeout(250);
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await expect(page.getByText("Не удалось проверить записи. Настройка не изменена.", { exact: true })).toHaveCount(0);
        expect(fixture.writes).toEqual([]);
        if (navigation === "unmount") {
          await navigateWithinApp(page, editor(secondId));
          await expect(toggle).toBeEnabled();
          const newRequest = page.waitForRequest(request => new URL(request.url()).pathname === queryPath(secondId));
          await toggle.click();
          await newRequest;
        }
        await expect(toggle).toBeChecked();
        await expect(toggle).toBeDisabled();
        fixture.current.release();
        await expect(toggle).not.toBeChecked();
        await expect(toggle).toBeEnabled();
        expect(fixture.writes).toEqual([{ path: `/api/entities/${secondId}`, body: { allowNoStatus: false } }]);
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
        expect(fixture.errors).toEqual([]);
      } finally {
        fixture.old.release();
        fixture.current.release();
      }
    });
  }
}