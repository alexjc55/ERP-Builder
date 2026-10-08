import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { db, pool, pagesTable, entitiesTable, pageFieldsTable, pageRecordValuesTable,
  entityRecordsTable, entityFieldsTable, viewsTable, NO_ACCESS_PERMS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveAuthoritativeView } from "./authoritative-view";
import { validateTargetAndConfig } from "../routes/views";

test("page-reference view filters read live source values and fail closed at source boundaries", async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  const schema = `view_ref_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    for (const { tablename } of (await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    await db.insert(entitiesTable).values({ id: 1, entityKey: "fixture", nameJson: {} });
    await db.insert(pagesTable).values([{ id: 1, mirrorEntityId: 1, nameJson: {} }, { id: 2, mirrorEntityId: 1, nameJson: {} }]);
    await db.insert(pageFieldsTable).values([
      { id: 1, pageId: 1, fieldKey: "shop", fieldType: "select", nameJson: {}, optionsJson: [{ value: "jackie", labelJson: { ru: "Джеки" } }] },
      { id: 2, pageId: 2, fieldKey: "alias", fieldType: "page_ref", nameJson: {}, pageRefConfigJson: { sourcePageId: 1, sourceFieldKey: "shop" } },
    ]);
    await db.insert(entityFieldsTable).values({ entityId: 1, fieldKey: "owner", fieldType: "user", nameJson: {} });
    await db.insert(entityRecordsTable).values([
      { id: 1, entityId: 1, valuesJson: { owner: 1 } },
      { id: 2, entityId: 1, valuesJson: { owner: 2 } },
      { id: 3, entityId: 1, valuesJson: { owner: 1 } },
    ]);
    await db.insert(pageRecordValuesTable).values([
      { pageId: 1, recordId: 1, valuesJson: { shop: "jackie" } },
      { pageId: 1, recordId: 2, valuesJson: { shop: "other" } },
      // Stale/fake alias storage must never be used.
      { pageId: 2, recordId: 2, valuesJson: { alias: "jackie" } },
    ]);
    const config = { filters: [{ source: "page" as const, field: "alias", operator: "eq", value: "jackie" }] };
    assert.equal(await validateTargetAndConfig(1, 2, config), null);
    await db.insert(viewsTable).values({ id: 1, entityId: 1, targetPageId: 2, viewKey: "reference", nameJson: {}, configJson: config });
    const req = (access = true): Request => ({
      user: { userId: 1, roleId: 1 }, roleIds: [1],
      permissions: { ...NO_ACCESS_PERMS, pageIds: access ? [1, 2] : [2],
        records: { "1": { view: true, create: false, update: false, delete: false, scope: "all" } } },
    } as unknown as Request);
    const result = async (request = req()) => resolveAuthoritativeView({ req: request, entityId: 1, pageId: 2, viewId: 1 });
    const ids = async (request = req()) => {
      const r = await result(request);
      if (!r.ok) throw new Error(r.error);
      return (await db.select({ id: entityRecordsTable.id }).from(entityRecordsTable).where(r.hardWhere)).map(r => r.id).sort();
    };
    assert.deepEqual(await ids(), [1]);
    await db.update(pageRecordValuesTable).set({ valuesJson: { shop: "jackie" } }).where(eq(pageRecordValuesTable.recordId, 2));
    assert.deepEqual(await ids(), [1, 2], "Source edits take effect without copying alias values");
    const denied = await result(req(false)); assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);
    const own = req();
    own.permissions!.records["mirror:1"] = { view: true, create: false, update: false, delete: false, scope: "own", scopeFieldKeys: ["owner"] };
    assert.deepEqual(await ids(own), [1], "Source own-row scope narrows the result");
    await db.update(viewsTable).set({ configJson: { filters: [{ source: "page", field: "alias", operator: "is_empty" }] } }).where(eq(viewsTable.id, 1));
    assert.deepEqual(await ids(), [3], "Missing source values use normal empty semantics");
    assert.equal((await result(req(false))).ok, false, "Empty tests must not bypass access");
    await db.update(pageFieldsTable).set({ isActive: false }).where(eq(pageFieldsTable.id, 1));
    assert.notEqual(await validateTargetAndConfig(1, 2, config), null);
    assert.equal((await result()).ok, false, "Deactivated source cannot silently remove a hard filter");
    await db.update(pageFieldsTable).set({ isActive: true }).where(eq(pageFieldsTable.id, 1));
    await db.update(pagesTable).set({ mirrorEntityId: 99 }).where(eq(pagesTable.id, 1));
    assert.equal((await result()).ok, false, "Cross-entity references are rejected");
  } finally {
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release(); await pool.end();
  }
});
