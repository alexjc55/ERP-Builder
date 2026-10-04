import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, cardTemplatesTable, entitiesTable, entityFieldsTable, entityRecordsTable, pagesTable, rolesTable, usersTable, NO_ACCESS_PERMS } from "@workspace/db";
import { signToken } from "../../artifacts/api-server/src/lib/jwt";

test("card registry: scope inheritance, draft validation, permission gates and atomic replacement", async ({ request, page }) => {
  test.setTimeout(90_000);
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.hostname).toBe("helium");
  expect(url.pathname).toBe("/heliumdb");
  const expected = process.env.CARD_E2E_DEV_FINGERPRINT;
  expect(expected, "Set fingerprint from independent development executeSql").toMatch(/^[a-f0-9]{32}$/);
  const fingerprint = await db.execute(sql`SELECT md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) AS fingerprint FROM entities`);
  expect(fingerprint.rows[0]?.fingerprint).toBe(expected);
  const [probeUser] = await db.select({ id: usersTable.id, roleId: usersTable.roleId }).from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id)).where(and(eq(usersTable.isActive, true), sql`${rolesTable.permissionsJson}->>'superAdmin' = 'true'`)).limit(1);
  expect(probeUser).toBeTruthy();
  const probe = await request.get("/api/entities", { headers: { Authorization: `Bearer ${signToken({ userId: probeUser.id, roleId: probeUser.roleId })}` } });
  expect(probe.ok()).toBe(true);
  const key = (e: { id: number; entityKey: string }) => `${e.id}:${e.entityKey}`;
  expect((await probe.json()).map(key).sort()).toEqual((await db.select().from(entitiesTable)).map(key).sort());
  const tag = randomUUID(), pageIds: number[] = [], entityIds: number[] = [], userIds: number[] = [], roleIds: number[] = [];
  try {
    const [pageRow] = await db.insert(pagesTable).values({ path: `/__cards-${tag}`, nameJson: { en: "Card fixture" } }).returning();
    pageIds.push(pageRow.id);
    const [entity, other] = await db.insert(entitiesTable).values([
      { entityKey: `cards-${tag}`, nameJson: { en: "Cards" }, pageId: pageRow.id },
      { entityKey: `other-cards-${tag}`, nameJson: { en: "Other" } },
    ]).returning();
    entityIds.push(entity.id, other.id);
    const [mirror] = await db.insert(pagesTable).values({ path: `/__cards-mirror-${tag}`, mirrorEntityId: entity.id, nameJson: { en: "Mirror" } }).returning();
    pageIds.push(mirror.id);
    const [adminRole, readerRole] = await db.insert(rolesTable).values([
      { nameJson: { en: `Card admin ${tag}` }, permissionsJson: { ...NO_ACCESS_PERMS,
        admin: { ...NO_ACCESS_PERMS.admin, cardTemplates: true }, pageIds,
        records: { [entity.id]: { view: true, create: true, update: true, delete: true } },
      } },
      { nameJson: { en: `Card reader ${tag}` }, permissionsJson: { ...NO_ACCESS_PERMS, pageIds, records: { [entity.id]: { view: true, create: false, update: false, delete: false } } } },
    ]).returning();
    roleIds.push(adminRole.id, readerRole.id);
    const [admin, reader] = await db.insert(usersTable).values([
      { email: `card-admin-${tag}@example.test`, firstName: "Card", lastName: "Admin", roleId: adminRole.id },
      { email: `card-reader-${tag}@example.test`, firstName: "Card", lastName: "Reader", roleId: readerRole.id },
    ]).returning();
    userIds.push(admin.id, reader.id);
    await db.insert(entityFieldsTable).values([
      { entityId: entity.id, fieldKey: "title", nameJson: { en: "Title" }, isRequired: true },
      { entityId: entity.id, fieldKey: "secret", nameJson: { en: "Hidden" }, permissionsJson: { [readerRole.id]: "hidden" } },
    ]);
    const adminHeaders = { Authorization: `Bearer ${signToken({ userId: admin.id, roleId: adminRole.id })}` };
    const readerHeaders = { Authorization: `Bearer ${signToken({ userId: reader.id, roleId: readerRole.id })}` };
    const api = (path: string, data?: unknown, method = "POST", headers = adminHeaders) =>
      request.fetch(`/api/card-templates${path}`, { method, data, headers });
    const layout = { version: 1, style: "standard", customStyle: {}, tabs: [{ id: "tab", title: { en: "General" }, sections: [{
      id: "section", title: {}, columns: 2, blocks: ["title", "secret"].map(fieldKey => ({ id: fieldKey, kind: "field", fieldKey, span: 1, modes: ["view", "create", "edit"], columns: [] })),
    }] }] };
    const create = async (name: string, pageId: number | null = null, customLayout: unknown = layout) => {
      const r = await api("", { name, entityId: entity.id, pageId, layout: customLayout });
      expect(r.status()).toBe(201); return r.json();
    };
    expect((await api("", { name: "Unsafe style", entityId: entity.id, layout: { ...layout, style: "custom", customStyle: { background: "url(https://example.invalid)" } } })).status()).toBe(400);
    const colored = await create("White text", null, { ...layout, style: "custom", customStyle: { textColor: "#ffffff" } });
    expect(colored.layout.customStyle.textColor).toBe("#ffffff");
    expect((await api("", { name: "Unsafe text color", entityId: entity.id, layout: { ...layout, style: "custom", customStyle: { textColor: "red;display:none" } } })).status()).toBe(400);
    const resolve = async (pageId?: number, headers = adminHeaders) => {
      const r = await api("/resolve", { entityId: entity.id, pageId, mode: "view" }, "POST", headers);
      expect(r.status()).toBe(200); return (await r.json()).template;
    };
    expect(await resolve(pageRow.id)).toBeNull();
    const original = await create("Entity original");
    expect(original.state).toBe("draft");
    expect(await resolve()).toBeNull();
    const firstPublish = await api(`/${original.id}/publish`, { expectedRevision: original.revision });
    expect(firstPublish.status()).toBe(200);
    const first = await firstPublish.json();
    expect((await resolve(mirror.id)).id).toBe(first.id);
    const hidden = await resolve(pageRow.id, readerHeaders);
    expect(hidden.layout.tabs[0].sections[0].blocks.map((b: { fieldKey: string }) => b.fieldKey)).toEqual(["title"]);
    expect((await api("", undefined, "GET", readerHeaders)).status()).toBe(403);
    expect((await api("/resolve", { entityId: entity.id, mode: "edit" }, "POST", readerHeaders)).status()).toBe(403);
    expect((await api("", { name: "Spoof", entityId: other.id, pageId: pageRow.id, layout })).status()).toBe(400);
    expect((await api(`/${first.id}`, { name: "Unsafe edit", entityId: entity.id, layout, expectedRevision: first.revision }, "PUT")).status()).toBe(409);
    expect((await api(`/${first.id}`, undefined, "DELETE")).status()).toBe(409);
    const override = await create("Page override", mirror.id);
    expect((await api(`/${override.id}/publish`, { expectedRevision: override.revision })).status()).toBe(200);
    expect((await resolve(mirror.id)).id).toBe(override.id);
    expect((await resolve(pageRow.id)).id).toBe(first.id);
    const replacement = await create("Replacement"), competing = await create("Competing");
    const conflict = await api(`/${replacement.id}/publish`, { expectedRevision: replacement.revision });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).active.id).toBe(first.id);
    expect((await resolve()).id).toBe(first.id); // Cancel leaves active unchanged.
    const races = await Promise.all([replacement, competing].map(card => api(`/${card.id}/publish`, {
      expectedRevision: card.revision, replaceId: first.id, replaceRevision: first.revision,
    })));
    expect(races.map(r => r.status()).sort()).toEqual([200, 409]);
    const all = await (await api("", undefined, "GET")).json();
    expect(all.filter((c: { entityId: number; pageId: number | null; state: string }) => c.entityId === entity.id && c.pageId === null && c.state === "published")).toHaveLength(1);
    expect(all.find((c: { id: number }) => c.id === first.id).state).toBe("draft");
    const incomplete = structuredClone(layout);
    incomplete.tabs[0].sections[0].blocks[0].fieldKey = "missing";
    const draft = await create("Incomplete", null, incomplete);
    expect((await api(`/${draft.id}/publish`, { expectedRevision: draft.revision })).status()).toBe(400);
    const updated = await api(`/${draft.id}`, { name: "Fixed", entityId: entity.id, layout, expectedRevision: draft.revision }, "PUT");
    expect(updated.status()).toBe(200);
    expect((await api(`/${draft.id}`, { name: "Stale edit", entityId: entity.id, layout, expectedRevision: draft.revision }, "PUT")).status()).toBe(409);
    const currentOverride = await resolve(mirror.id);
    expect((await api(`/${override.id}/unpublish`, { expectedRevision: currentOverride.revision })).status()).toBe(200);
    expect((await resolve(mirror.id)).id).toBe((await resolve()).id);
    // Real browser, real API, isolated records: confirms generated clients,
    // admin capability and record-form renderer agree with the live contracts.
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(token => localStorage.setItem("erp_token", token), signToken({ userId: admin.id, roleId: adminRole.id }));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/card-templates/${draft.id}`);
    await expect(page.getByTestId("input-editor-name")).toHaveValue("Fixed");
    await page.getByTestId("input-editor-name").fill("Browser saved draft");
    const saveResponse = page.waitForResponse(r => r.url().endsWith(`/api/card-templates/${draft.id}`) && r.request().method() === "PUT");
    await page.getByTestId("button-save-draft").click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByTestId("text-dirty")).toHaveCount(0);
    await page.screenshot({ path: "screenshots/card-builder-desktop.png" });
    const [record] = await db.insert(entityRecordsTable).values({ entityId: entity.id, valuesJson: { title: "Browser fixture", secret: "Allowed to admin" } }).returning();
    await page.goto(`/__cards-${tag}`);
    await page.locator(`[data-testid="record-edit-button"][data-record-id="${record.id}"]`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("card-section-section")).toBeVisible();
    await dialog.locator('input[value="Browser fixture"]').fill("Keep my draft");
    const current = await resolve();
    const next = await create("Published while editing");
    expect((await api(`/${next.id}/publish`, { expectedRevision: next.revision, replaceId: current.id, replaceRevision: current.revision })).status()).toBe(200);
    await page.waitForTimeout(250);
    await expect(dialog.locator('input[value="Keep my draft"]')).toBeVisible();
    await expect(dialog.getByTestId("record-dialog-save")).toBeEnabled();
    await page.setViewportSize({ width: 402, height: 874 });
    await page.screenshot({ path: "screenshots/card-runtime-mobile.png" });
    expect(errors).toEqual([]);
  } finally {
    if (entityIds.length) {
      await db.delete(cardTemplatesTable).where(inArray(cardTemplatesTable.entityId, entityIds));
      await db.delete(entityRecordsTable).where(inArray(entityRecordsTable.entityId, entityIds));
      await db.delete(entityFieldsTable).where(inArray(entityFieldsTable.entityId, entityIds));
      await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    }
    if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));
  }
});
test.afterAll(async () => { await pool.end(); });