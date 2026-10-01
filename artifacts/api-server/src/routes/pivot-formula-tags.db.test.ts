import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable,
  pagesTable, pageFieldsTable, pageRecordValuesTable, tagsTable, statusTagsTable,
} from "@workspace/db";
import { computePivot, type PivotConfigInput } from "./pivot-compute";
import { systemFormulaPermissions } from "../lib/formula-runtime";

after(() => pool.end());

test("configured pivot formula SUM and status tag axes preserve scope and full-set winners", {
  skip: process.env.RUN_PIVOT_FORMULA_DB !== "1",
}, async t => {
  const endpoint = new URL(process.env.DATABASE_URL!);
  assert.equal(endpoint.hostname, "helium");
  assert.equal(endpoint.pathname, "/heliumdb");
  const identity = await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`);
  assert.equal(identity.rows[0].database, "heliumdb");
  assert.ok(process.env.PIVOT_FORMULA_DEV_FINGERPRINT);
  assert.equal(identity.rows[0].fingerprint, process.env.PIVOT_FORMULA_DEV_FINGERPRINT);
  const key = `pivot_formula_${randomUUID().replaceAll("-", "")}`;
  const entityIds: number[] = [], pageIds: number[] = [], tagIds: number[] = [];
  try {
    const [entity] = await db.insert(entitiesTable).values({ entityKey: key, nameJson: { en: key }, pivotEnabled: true }).returning();
    entityIds.push(entity.id);
    const [page] = await db.insert(pagesTable).values({ nameJson: { en: key }, mirrorEntityId: entity.id }).returning();
    pageIds.push(page.id);
    const statuses = await db.insert(entityStatusesTable).values([
      { entityId: entity.id, statusKey: "a", nameJson: { en: "A" } },
      { entityId: entity.id, statusKey: "b", nameJson: { en: "B" } },
    ]).returning();
    const tags = await db.insert(tagsTable).values([
      { nameJson: { en: "X" }, sortOrder: 1 }, { nameJson: { en: "Y" }, sortOrder: 2 },
    ]).returning();
    tagIds.push(...tags.map(tag => tag.id));
    await db.insert(statusTagsTable).values(tags.map(tag => ({ statusId: statuses[0].id, tagId: tag.id })));
    const fields = await db.insert(entityFieldsTable).values([
      { entityId: entity.id, fieldKey: "qty", fieldType: "number", nameJson: { en: "Qty" }, pivotEnabled: true },
      { entityId: entity.id, fieldKey: "batch", fieldType: "text", nameJson: { en: "Batch" }, pivotEnabled: true },
      { entityId: entity.id, fieldKey: "amount", fieldType: "function", nameJson: { en: "Amount" }, pivotEnabled: true, formulaConfigJson: { expression: "{qty}*2", decimals: 2 } },
      { entityId: entity.id, fieldKey: "once", fieldType: "function", nameJson: { en: "Once" }, pivotEnabled: true,
        formulaConfigJson: { expression: "{amount}", groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "batch" }] } } },
      { entityId: entity.id, fieldKey: "broken", fieldType: "function", nameJson: { en: "Broken" }, pivotEnabled: true, formulaConfigJson: { expression: "1 +" } },
      { entityId: entity.id, fieldKey: "text", fieldType: "function", nameJson: { en: "Text" }, pivotEnabled: true, formulaConfigJson: { expression: '"not numeric"' } },
      { entityId: entity.id, fieldKey: "rounded", fieldType: "function", nameJson: { en: "Rounded" }, pivotEnabled: true, formulaConfigJson: { expression: "{qty}/3", decimals: 2 } },
      { entityId: entity.id, fieldKey: "linked", fieldType: "function", nameJson: { en: "Linked" }, pivotEnabled: true, formulaConfigJson: {
        expression: "{linked:qty}", sources: [{ kind: "aggregate", key: "linked:qty", targetEntityId: entity.id,
          aggregate: "sum", value: { scope: "entity", fieldKey: "qty" },
          join: { kind: "equality", on: [{ base: { scope: "entity", fieldKey: "batch" }, target: { scope: "entity", fieldKey: "batch" } }] },
        }],
      } },
    ]).returning();
    const pageFields = await db.insert(pageFieldsTable).values([
      { pageId: page.id, fieldKey: "extra", fieldType: "number", nameJson: { en: "Extra" }, pivotEnabled: true },
      { pageId: page.id, fieldKey: "page_amount", fieldType: "function", nameJson: { en: "Page amount" }, pivotEnabled: true,
        formulaConfigJson: { expression: `{entity:${entity.id}.amount}+{extra}` } },
      { pageId: page.id, fieldKey: "page_once", fieldType: "function", nameJson: { en: "Page once" }, pivotEnabled: true,
        formulaConfigJson: { expression: "{page_amount}", groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "batch" }] } } },
    ]).returning();
    const rows = await db.insert(entityRecordsTable).values([
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 2, batch: "A", amount: 999 }, createdAt: new Date("2024-01-01") },
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 3, batch: "B" }, createdAt: new Date("2024-01-02") },
      { entityId: entity.id, statusId: statuses[1].id, valuesJson: { qty: 4, batch: "A" }, createdAt: new Date("2024-01-03") },
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 999, batch: "A" }, archivedAt: new Date(), createdAt: new Date("2020-01-01") },
    ]).returning();
    await db.insert(pageRecordValuesTable).values(rows.slice(0, 3).map(row => ({
      pageId: page.id, recordId: row.id, valuesJson: { extra: 1, page_amount: 99999 },
    })));
    const where = and(eq(entityRecordsTable.entityId, entity.id), isNull(entityRecordsTable.archivedAt))!;
    const compute = (pivot: PivotConfigInput, overrides = {}) => computePivot({
      entityId: entity.id, pivot, entityFields: fields, pageFields, pageId: page.id, relationMeta: new Map(),
      where, formulaPermissions: systemFormulaPermissions, ...overrides,
    });
    const amount = { agg: "sum", source: "entity", fieldKey: "amount" };
    await t.test("configured entity/page formulas ignore stale JSON and unrelated errors", async () => {
      const result = await compute({ rows: { source: "status" }, measure: amount });
      assert.ok(result.ok, result.ok ? "" : result.error);
      assert.equal(result.result.grandTotal, 18);
      const pageResult = await compute({ rows: { source: "status" }, measure: { ...amount, source: "page", fieldKey: "page_amount" } });
      assert.ok(pageResult.ok, pageResult.ok ? "" : pageResult.error);
      assert.equal(pageResult.result.grandTotal, 21);
      const rounded = await compute({ rows: { source: "status" }, measure: { ...amount, fieldKey: "rounded" } });
      assert.ok(rounded.ok, rounded.ok ? "" : rounded.error);
      assert.equal(rounded.result.grandTotal, 3);
      for (const fieldKey of ["broken", "text"]) {
        const invalid = await compute({ rows: { source: "status" }, measure: { ...amount, fieldKey } });
        assert.equal(invalid.ok, false);
      }
    });
    await t.test("linked sources use the supplied adapter, not implicit SYSTEM", async () => {
      const pivot = { rows: { source: "status" }, measure: { ...amount, fieldKey: "linked" } };
      const result = await compute(pivot);
      assert.ok(result.ok, result.ok ? "" : result.error);
      assert.equal(result.result.grandTotal, 15);
      const denied = await compute(pivot, { formulaPermissions: {
        ...systemFormulaPermissions, authorizeResources: async () => new Set<string>(),
      } });
      assert.ok(denied.ok, denied.ok ? "" : denied.error);
      assert.equal(denied.result.grandTotal, 0);
    });
    await t.test("multi-measures preserve count SQL, numeric SQL, configured sum and calc", async () => {
      const result = await compute({ rows: { source: "status" }, measures: [
        { key: "count", agg: "count" }, { key: "qty", ...amount, fieldKey: "qty" },
        { key: "amount", ...amount }, { key: "twice", agg: "calc", formula: "{amount}*2" },
      ] });
      assert.ok(result.ok, result.ok ? "" : result.error);
      assert.deepEqual(Object.fromEntries(result.result.colTotals.map(c => [c.key, c.value])), { count: 3, qty: 9, amount: 18, twice: 36 });
    });
    await t.test("tag memberships overlap including untagged and both axes", async () => {
      const result = await compute({ rows: { source: "statusTag" }, measure: amount });
      assert.ok(result.ok, result.ok ? "" : result.error);
      assert.equal(result.result.grandTotal, 28);
      assert.deepEqual(result.result.rows.map(r => r.label), ["X", "Y", "Без тега"]);
      const both = await compute({ rows: { source: "statusTag" }, cols: { source: "statusTag" }, measure: { agg: "count" } });
      assert.ok(both.ok, both.ok ? "" : both.error);
      assert.equal(both.result.grandTotal, 9);
    });
    await t.test("group result uses complete scoped universe before axes", async () => {
      const result = await compute({ rows: { source: "status" }, measure: { ...amount, fieldKey: "once" } });
      assert.ok(result.ok, result.ok ? "" : result.error);
      assert.equal(result.result.grandTotal, 10);
      assert.ok(!result.result.cells.some(c => c.rowKey === String(statuses[1].id) && c.value !== 0));
      const narrow = await compute({ rows: { source: "status" }, measure: { ...amount, fieldKey: "once" } },
        { where: and(where, eq(entityRecordsTable.id, rows[2].id))! });
      assert.ok(narrow.ok, narrow.ok ? "" : narrow.error);
      assert.equal(narrow.result.grandTotal, 8);
      const page = await compute({ rows: { source: "statusTag" }, measure: { ...amount, source: "page", fieldKey: "page_once" } });
      assert.ok(page.ok, page.ok ? "" : page.error);
      assert.equal(page.result.grandTotal, 24); // (5 + 7) in each of two tags
    });
    await t.test("caller-visible field and opt-in boundaries are authoritative", async () => {
      const pivot = { rows: { source: "status" }, measure: amount };
      assert.equal((await compute(pivot, { entityFields: fields.filter(f => f.fieldKey !== "amount") })).ok, false);
      assert.equal((await compute(pivot, { entityFields: fields.map(f => f.fieldKey === "amount" ? { ...f, pivotEnabled: false } : f) })).ok, false);
      const hiddenDependency = await compute(pivot, { entityFields: fields.filter(f => f.fieldKey !== "qty"), formulaPermissions: undefined });
      assert.ok(hiddenDependency.ok, hiddenDependency.ok ? "" : hiddenDependency.error);
      assert.equal(hiddenDependency.result.grandTotal, 0);
    });
  } finally {
    if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
    if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    if (tagIds.length) await db.delete(tagsTable).where(inArray(tagsTable.id, tagIds));
  }
});