import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool, pagesTable, entitiesTable, pageFieldsTable, pageRecordValuesTable,
  viewsTable, dashboardWidgetsTable, cardTemplatesTable, rolesTable, usersTable, NO_ACCESS_PERMS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { duplicatePage } from "./duplicate-page";
import router from "../routes/pages";
import { signToken } from "./jwt";

test("page duplication preserves configuration but not records, grants or protected page identities", async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  const schema = `page_copy_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const [main] = await db.insert(pagesTable).values({ nameJson: { ru: "Основная" } }).returning();
    const [entity] = await db.insert(entitiesTable).values({ nameJson: {}, entityKey: "copy_fixture", pageId: main.id }).returning();
    const [source] = await db.insert(pagesTable).values({
      nameJson: { ru: "Проекты", en: "Projects", he: "פרויקטים" }, path: "/projects", mirrorEntityId: entity.id,
      mirrorFieldKeysJson: ["name"], mirrorFieldLabelsJson: { name: { ru: "Проект" } },
      mirrorColumnOrderJson: ["p:note", "e:name"], mirrorPinnedJson: { "e:name": true },
      defaultQuickFilterJson: { fieldFilters: { name: ["A"] } }, defaultPageSize: 100,
      textDirection: "rtl", disableCreate: true, parentPageId: main.id,
    }).returning();
    await db.insert(pagesTable).values({ nameJson: { ru: "Дочерняя" }, parentPageId: source.id });
    await db.insert(pageFieldsTable).values({ pageId: source.id, fieldKey: "note", nameJson: { ru: "Заметка" }, fieldType: "text", showInTable: false });
    await db.insert(pageRecordValuesTable).values({ pageId: source.id, recordId: 123, valuesJson: { note: "Do not copy business data" } });
    await db.insert(viewsTable).values({ entityId: entity.id, targetPageId: source.id, viewKey: "table",
      nameJson: {}, isDefault: true, configJson: { viewType: "table", pageId: source.id }, visibleRoleIdsJson: [2] });
    await db.insert(dashboardWidgetsTable).values({ pageId: source.id, configJson: { pageId: source.id }, visibleRoleIdsJson: [2] });
    await db.insert(cardTemplatesTable).values({ entityId: entity.id, pageId: source.id,
      name: "Card", state: "published", layout: { version: 1, style: "standard", customStyle: {}, tabs: [{ id: "main", title: { ru: "Главная" }, sections: [] }] } });
    await db.insert(rolesTable).values([
      { id: 1, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, admin: { ...NO_ACCESS_PERMS.admin, pages: true } } },
      { id: 2, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, pageIds: [source.id] } },
    ]);
    await db.insert(usersTable).values([
      { id: 1, email: "admin@fixture.invalid", firstName: "Admin", lastName: "", roleId: 1 },
      { id: 2, email: "reader@fixture.invalid", firstName: "Reader", lastName: "", roleId: 2 },
    ]);
    const app = express(); app.use(express.json()); app.use(router);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const post = (id: number, userId?: number) => fetch(`http://127.0.0.1:${addr.port}/pages/${id}/duplicate`, {
      method: "POST", headers: userId ? { authorization: `Bearer ${signToken({ userId, roleId: userId, sessionVersion: 0 })}` } : {},
    });
    assert.equal((await post(source.id)).status, 401);
    assert.equal((await post(source.id, 2)).status, 403);
    assert.equal((await post(main.id, 1)).status, 400);
    const response = await post(source.id, 1);
    assert.equal(response.status, 201);
    const copy = await response.json() as typeof source;
    assert.notEqual(copy.id, source.id);
    assert.notEqual(copy.path, source.path);
    assert.equal((copy.nameJson as { ru: string }).ru, "Проекты (копия)");
    for (const key of ["mirrorEntityId", "mirrorFieldKeysJson", "mirrorFieldLabelsJson", "mirrorColumnOrderJson",
      "mirrorPinnedJson", "defaultQuickFilterJson", "defaultPageSize", "textDirection", "disableCreate", "parentPageId"] as const) {
      assert.deepEqual(copy[key], source[key], key);
    }
    const [field] = await db.select().from(pageFieldsTable).where(eq(pageFieldsTable.pageId, copy.id));
    assert.equal(field.fieldKey, "note"); assert.equal(field.showInTable, false);
    const [view] = await db.select().from(viewsTable).where(eq(viewsTable.targetPageId, copy.id));
    assert.equal(view.isDefault, true); assert.notEqual(view.viewKey, "table");
    assert.deepEqual(view.configJson, { viewType: "table", pageId: copy.id });
    const [widget] = await db.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.pageId, copy.id));
    assert.deepEqual(widget.visibleRoleIdsJson, [2]); assert.deepEqual(widget.configJson, { pageId: copy.id });
    const [card] = await db.select().from(cardTemplatesTable).where(eq(cardTemplatesTable.pageId, copy.id));
    assert.equal(card.state, "published");
    assert.equal((await db.select().from(pageRecordValuesTable).where(eq(pageRecordValuesTable.pageId, copy.id))).length, 0);
    assert.equal((await db.select().from(pagesTable).where(eq(pagesTable.parentPageId, copy.id))).length, 0);
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, 2));
    assert.deepEqual(role.permissionsJson.pageIds, [source.id]);
    await db.update(pageFieldsTable).set({ showInTable: true }).where(eq(pageFieldsTable.id, field.id));
    assert.equal((await db.select().from(pageFieldsTable).where(eq(pageFieldsTable.pageId, source.id)))[0].showInTable, false);
    const second = await duplicatePage(source.id); assert.equal(second.status, 201);
    if (second.status === 201) assert.notEqual(second.page.path, copy.path);
    for (const settings of [{ isSystem: true }, { path: "/admin/custom" }]) {
      const [protectedPage] = await db.insert(pagesTable).values({ nameJson: {}, ...settings }).returning();
      assert.equal((await duplicatePage(protectedPage.id)).status, 400);
    }
    for (const settings of [{ isDashboard: true }, { isPivot: true, pivotEntityId: entity.id,
      pivotConfigJson: { source: "custom" as const, pivot: { rows: ["name"] } } }, {}]) {
      const [page] = await db.insert(pagesTable).values({ nameJson: { ru: "Report" }, ...settings }).returning();
      const result = await duplicatePage(page.id); assert.equal(result.status, 201);
      if (result.status === 201) {
        assert.equal(result.page.isDashboard, page.isDashboard);
        assert.deepEqual(result.page.pivotConfigJson, page.pivotConfigJson);
      }
    }
    assert.equal((await duplicatePage(2147483647)).status, 404);
    // A failure while copying dependent configuration must not leave half a page.
    const before = (await db.select().from(pagesTable)).length;
    await bootstrap.query(`CREATE FUNCTION "${schema}".reject_copied_widget() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$`);
    await bootstrap.query(`CREATE TRIGGER reject_copy BEFORE INSERT ON "${schema}".dashboard_widgets
      FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_copied_widget()`);
    await assert.rejects(() => duplicatePage(source.id));
    assert.equal((await db.select().from(pagesTable)).length, before);
  } finally {
    if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release(); await pool.end();
  }
});
