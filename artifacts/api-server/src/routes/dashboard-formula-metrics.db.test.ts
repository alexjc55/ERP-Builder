import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable,
  pagesTable, pageFieldsTable, pageRecordValuesTable, tagsTable, statusTagsTable,
  relationsTable, recordLinksTable,
} from "@workspace/db";
import { computeMetric, validateMetricLike } from "./dashboard";
import { evaluateFormula } from "@workspace/formula";
import { loadFormulaOptions } from "../lib/formula-runtime";

after(() => pool.end());

// Independently verify development identity before supplying the fingerprint.
// Explicit opt-in + exact local endpoint + read-only database fingerprint gate
// precede ALL mutations. Never run this test against a production database.
test("dashboard entity/page formula SUM uses full filtered runtime values and preserves SQL counts", {
  skip: process.env.RUN_DASHBOARD_FORMULA_DB !== "1",
}, async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "helium");
  assert.equal(url.pathname, "/heliumdb");
  const identity = await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`);
  assert.equal(identity.rows[0].database, "heliumdb");
  assert.ok(process.env.DASHBOARD_FORMULA_DEV_FINGERPRINT);
  assert.equal(identity.rows[0].fingerprint, process.env.DASHBOARD_FORMULA_DEV_FINGERPRINT);
  const run = `widget_formula_${randomUUID().replaceAll("-", "")}`;
  const entityIds: number[] = [], pageIds: number[] = [], tagIds: number[] = [];
  try {
    const [entity, target] = await db.insert(entitiesTable).values([
      { entityKey: run, nameJson: { en: run } },
      { entityKey: `${run}_target`, nameJson: { en: run } },
    ]).returning();
    entityIds.push(entity.id, target.id);
    const [relation] = await db.insert(relationsTable).values({
      relationKey: `${run}_link`, nameJson: { en: "Linked group" }, relationType: "many_to_one",
      sourceEntityId: entity.id, targetEntityId: target.id,
    }).returning();
    const [page] = await db.insert(pagesTable).values({ nameJson: { en: run }, mirrorEntityId: entity.id }).returning();
    pageIds.push(page.id);
    const statuses = await db.insert(entityStatusesTable).values([
      { entityId: entity.id, statusKey: "a", nameJson: { en: "A" } },
      { entityId: entity.id, statusKey: "b", nameJson: { en: "B" } },
    ]).returning();
    const [tag, tag2] = await db.insert(tagsTable).values([
      { nameJson: { en: `${run}_tag` } }, { nameJson: { en: `${run}_tag2` } },
    ]).returning();
    tagIds.push(tag.id, tag2.id);
    await db.insert(statusTagsTable).values([
      { statusId: statuses[0].id, tagId: tag.id },
      { statusId: statuses[0].id, tagId: tag2.id },
    ]);
    await db.insert(entityFieldsTable).values([
      ...["qty", "price"].map(fieldKey => ({ entityId: entity.id, fieldKey, nameJson: { en: fieldKey }, fieldType: "number" })),
      { entityId: entity.id, fieldKey: "batch", nameJson: { en: "Batch" }, fieldType: "text" },
      { entityId: entity.id, fieldKey: "group_project", nameJson: { en: "Linked group" }, fieldType: "relation",
        relationConfigJson: { relationId: relation.id, relatedFieldKey: "batch" } },
      { entityId: entity.id, fieldKey: "created", nameJson: { en: "Created" }, fieldType: "created_at" },
      { entityId: entity.id, fieldKey: "amount", nameJson: { en: "Amount" }, fieldType: "function", formulaConfigJson: { expression: "{qty}*{price}", decimals: 2 } },
      { entityId: entity.id, fieldKey: "chain", nameJson: { en: "Chain" }, fieldType: "function", formulaConfigJson: { expression: "{amount}*2" } },
      { entityId: entity.id, fieldKey: "once", nameJson: { en: "Once" }, fieldType: "function", formulaConfigJson: { expression: "{amount}", groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "batch" }] } } },
      { entityId: entity.id, fieldKey: "linked_once", nameJson: { en: "Linked once" }, fieldType: "function", formulaConfigJson: { expression: "{amount}", groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "group_project" }] } } },
      { entityId: entity.id, fieldKey: "page_input", nameJson: { en: "Page input" }, fieldType: "function", formulaConfigJson: { expression: `{page:${page.id}.surcharge}+{amount}` } },
      { entityId: entity.id, fieldKey: "computed_page_input", nameJson: { en: "Computed page input" }, fieldType: "function", formulaConfigJson: { expression: `{page:${page.id}.page_sum}` } },
      { entityId: entity.id, fieldKey: "days", nameJson: { en: "Days" }, fieldType: "function", formulaConfigJson: { expression: 'workingDaysBetween({created}, "2024-01-05")' } },
      { entityId: entity.id, fieldKey: "external", nameJson: { en: "External" }, fieldType: "function", formulaConfigJson: {
        expression: "{linked:cost}+{amount}", sources: [{ kind: "aggregate", key: "linked:cost", targetEntityId: target.id,
          aggregate: "sum", value: { scope: "entity", fieldKey: "cost" },
          join: { kind: "equality", on: [{ base: { scope: "entity", fieldKey: "batch" }, target: { scope: "entity", fieldKey: "batch" } }] },
        }],
      } },
      { entityId: target.id, fieldKey: "batch", nameJson: { en: "Batch" }, fieldType: "text" },
      { entityId: target.id, fieldKey: "cost", nameJson: { en: "Cost" }, fieldType: "number" },
    ]);
    await db.insert(pageFieldsTable).values([
      { pageId: page.id, fieldKey: "surcharge", nameJson: { en: "Surcharge" }, fieldType: "number" },
      { pageId: page.id, fieldKey: "page_sum", nameJson: { en: "Page sum" }, fieldType: "function", formulaConfigJson: { expression: `{entity:${entity.id}.amount}+{surcharge}` } },
      { pageId: page.id, fieldKey: "page_chain", nameJson: { en: "Page chain" }, fieldType: "function", formulaConfigJson: { expression: "{page_sum}*2" } },
      { pageId: page.id, fieldKey: "page_once", nameJson: { en: "Page once" }, fieldType: "function", formulaConfigJson: {
        expression: "{page_sum}", groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "batch" }] },
      } },
    ]);
    const rows = await db.insert(entityRecordsTable).values([
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 3, price: 2, batch: "A", amount: 9999 }, createdAt: new Date("2024-01-01T08:00:00Z") },
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 7, price: 4, batch: "A" }, createdAt: new Date("2024-01-02T08:00:00Z") },
      { entityId: entity.id, statusId: statuses[1].id, valuesJson: { qty: 2, price: 5, batch: "B" }, createdAt: new Date("2024-01-03T08:00:00Z") },
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 100, price: 100, batch: "A" }, archivedAt: new Date(), createdAt: new Date("2020-01-01") },
    ]).returning();
    await db.insert(pageRecordValuesTable).values(rows.slice(0, 3).map((row, i) => ({
      pageId: page.id, recordId: row.id, valuesJson: { surcharge: i + 3, page_sum: 99999 },
    })));
    const targets = await db.insert(entityRecordsTable).values([
      { entityId: target.id, valuesJson: { batch: "A", cost: 4 } },
      { entityId: target.id, valuesJson: { batch: "A", cost: 6 } },
      { entityId: target.id, valuesJson: { batch: "B", cost: 20 } },
      { entityId: target.id, valuesJson: { batch: "A", cost: 999 }, archivedAt: new Date() },
    ]).returning();
    await db.insert(recordLinksTable).values(rows.slice(0, 3).map((row, i) => ({
      relationId: relation.id, relationType: "many_to_one", sourceRecordId: row.id, targetRecordId: targets[i].id,
    })));
    const metric = (fieldKey: string, extra = {}) => computeMetric({ key: "value", entityId: entity.id, aggregation: "sum", fieldKey, ...extra });
    await t.test("live formula chain, archive/status/tag intersection and no duplicated tag membership", async () => {
      assert.equal(await metric("amount"), 44);
      assert.equal(await metric("chain"), 88);
      assert.equal(await metric("amount", { statusIds: [statuses[0].id] }), 34);
      assert.equal(await metric("amount", { statusTagIds: tagIds }), 34);
      assert.equal(await metric("amount", { statusTagIds: [tag.id], statusIds: [statuses[1].id] }), 0);
      assert.equal(await computeMetric({ key: "count", entityId: entity.id, aggregation: "count" }), 3);
      assert.equal(await metric("price"), 11);
    });
    await t.test("shared linked/page source runtime, page chains, SYSTEM scope and calendar settings", async () => {
      assert.equal(await metric("page_input"), 56);
      assert.equal(await metric("computed_page_input"), 56);
      assert.equal(await metric("external"), 84);
      assert.equal(await metric("page_sum", { source: "page", pageId: page.id }), 56);
      assert.equal(await metric("page_chain", { source: "page", pageId: page.id }), 112);
      const options = await loadFormulaOptions();
      const expected = rows.slice(0, 3).reduce((n, row) => n + Number(evaluateFormula('workingDaysBetween({created}, "2024-01-05")', { created: row.createdAt.toISOString() }, options)), 0);
      assert.equal(await metric("days"), expected);
    });
    await t.test("canonical page same-key value cannot replace an entity formula identity", async () => {
      await db.update(pagesTable).set({ mirrorEntityId: null }).where(eq(pagesTable.id, page.id));
      await db.update(entitiesTable).set({ pageId: page.id }).where(eq(entitiesTable.id, entity.id));
      await db.insert(pageFieldsTable).values([
        { pageId: page.id, fieldKey: "amount", nameJson: { en: "Shadow" }, fieldType: "number" },
        { pageId: page.id, fieldKey: "page_shadow_copy", nameJson: { en: "Shadow copy" }, fieldType: "function", formulaConfigJson: { expression: "{amount}+1" } },
      ]);
      for (const [i, row] of rows.slice(0, 3).entries()) {
        await db.update(pageRecordValuesTable).set({ valuesJson: { surcharge: i + 3, page_sum: 99999, amount: 100 } })
          .where(and(eq(pageRecordValuesTable.pageId, page.id), eq(pageRecordValuesTable.recordId, row.id)));
      }
      assert.equal(await metric("amount"), 44);
      assert.equal(await metric("chain"), 600); // flat {amount} sees page scalar 100
      assert.equal(await metric("page_shadow_copy", { source: "page", pageId: page.id }), 303);
      await db.update(entitiesTable).set({ pageId: null }).where(eq(entitiesTable.id, entity.id));
      await db.update(pagesTable).set({ mirrorEntityId: entity.id }).where(eq(pagesTable.id, page.id));
    });
    await t.test("one-time winners computed over filtered full set before any display limit", async () => {
      assert.equal(await metric("once"), 16);
      assert.equal(await metric("linked_once"), 16);
      assert.equal(await metric("once", { statusIds: [statuses[1].id] }), 10);
      assert.equal(await metric("page_once", { source: "page", pageId: page.id }), 24);
      await db.insert(entityRecordsTable).values(Array.from({ length: 505 }, () => ({
        entityId: entity.id, statusId: statuses[1].id, valuesJson: { qty: 1, price: 1, batch: "A" },
      })));
      assert.equal(await metric("amount"), 549);
      assert.equal(await metric("once"), 16);
      assert.equal(await metric("amount", { statusTagIds: [tag.id] }), 34);
    });
    await t.test("save/runtime validation: inactive, stale numeric-to-text formula changes fail explicitly", async () => {
      assert.equal(await validateMetricLike({ entityId: entity.id, aggregation: "sum", fieldKey: "amount" }), null);
      assert.equal(await validateMetricLike({ entityId: 0, aggregation: "sum", source: "page", pageId: page.id, fieldKey: "page_sum" }), null);
      assert.match((await validateMetricLike({ entityId: entity.id, aggregation: "sum", fieldKey: "batch" }))!, /not numeric/);
      await db.update(entityFieldsTable).set({ formulaConfigJson: { expression: '"2026-01-01"' } })
        .where(and(eq(entityFieldsTable.entityId, entity.id), eq(entityFieldsTable.fieldKey, "chain")));
      await assert.rejects(metric("chain"), /Cannot sum formula/);
      for (const expression of ["1 +", "{chain}", "{empty_dependency}"]) {
        if (expression === "{empty_dependency}") await db.insert(entityFieldsTable).values({
          entityId: entity.id, fieldKey: "empty_dependency", nameJson: { en: "Empty formula" }, fieldType: "function",
        });
        await db.update(entityFieldsTable).set({ formulaConfigJson: { expression } })
          .where(and(eq(entityFieldsTable.entityId, entity.id), eq(entityFieldsTable.fieldKey, "chain")));
        await assert.rejects(metric("chain"), /Cannot sum formula/);
        // An unrelated broken formula must not break a valid target.
        assert.equal(await metric("amount"), 549);
      }
      await db.update(entityFieldsTable).set({ formulaConfigJson: { expression: "{missing_value}" } })
        .where(and(eq(entityFieldsTable.entityId, entity.id), eq(entityFieldsTable.fieldKey, "chain")));
      assert.equal(await metric("chain"), 0); // legitimate empty, not evaluation error
      await db.insert(pageFieldsTable).values({
        pageId: page.id, fieldKey: "page_cycle", nameJson: { en: "Page cycle" }, fieldType: "function",
        formulaConfigJson: { expression: `{page:${page.id}.page_cycle}` },
      });
      await assert.rejects(metric("page_cycle", { source: "page", pageId: page.id }), /circular/);
      await db.update(pageFieldsTable).set({ formulaConfigJson: { expression: "1 +" } })
        .where(and(eq(pageFieldsTable.pageId, page.id), eq(pageFieldsTable.fieldKey, "page_sum")));
      await assert.rejects(metric("computed_page_input"), /Cannot sum formula/);
      assert.equal(await metric("amount"), 549);
      await db.update(entityFieldsTable).set({ isActive: false }).where(eq(entityFieldsTable.entityId, entity.id));
      await assert.rejects(metric("amount"), /unavailable/);
    });
  } finally {
    if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
    if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    if (tagIds.length) await db.delete(tagsTable).where(inArray(tagsTable.id, tagIds));
  }
});