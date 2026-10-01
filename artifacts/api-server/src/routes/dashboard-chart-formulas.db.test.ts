import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable,
  pagesTable, pageFieldsTable, pageRecordValuesTable, tagsTable, statusTagsTable,
  relationsTable, recordLinksTable,
} from "@workspace/db";
import { computeChartSeries, computeMetric, validateChartConfig, validateMetricLike } from "./dashboard";

after(() => pool.end());

test("charts use live formula sums before status/tag/field expansion; related sums repeat per link", {
  skip: process.env.RUN_DASHBOARD_CHART_DB !== "1",
}, async t => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "helium");
  assert.equal(url.pathname, "/heliumdb");
  const fingerprint = async () => (await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`)).rows[0];
  const identity = await fingerprint();
  assert.equal(identity.database, "heliumdb");
  assert.ok(process.env.DASHBOARD_CHART_DEV_FINGERPRINT);
  assert.equal(identity.fingerprint, process.env.DASHBOARD_CHART_DEV_FINGERPRINT);
  const run = `chart_formula_${randomUUID().replaceAll("-", "")}`;
  const entityIds: number[] = [], pageIds: number[] = [], tagIds: number[] = [];
  try {
    const [entity, target] = await db.insert(entitiesTable).values([
      { entityKey: run, nameJson: { en: run } }, { entityKey: `${run}_target`, nameJson: { en: run } },
    ]).returning();
    entityIds.push(entity.id, target.id);
    const [page] = await db.insert(pagesTable).values({ nameJson: { en: run }, mirrorEntityId: entity.id }).returning();
    pageIds.push(page.id);
    const statuses = await db.insert(entityStatusesTable).values([
      { entityId: entity.id, statusKey: "a", nameJson: { en: "First" }, sortOrder: 1, showTags: false },
      { entityId: entity.id, statusKey: "b", nameJson: { en: "Second" }, sortOrder: 2 },
      { entityId: entity.id, statusKey: "c", nameJson: { en: "Third" }, sortOrder: 3 },
    ]).returning();
    const tags = await db.insert(tagsTable).values([
      { nameJson: { en: "Alpha" }, color: "#112233", sortOrder: 1 },
      { nameJson: { en: "Beta" }, color: "#445566", sortOrder: 2 },
    ]).returning();
    tagIds.push(...tags.map(tag => tag.id));
    await db.insert(statusTagsTable).values([
      { statusId: statuses[0].id, tagId: tags[0].id }, { statusId: statuses[0].id, tagId: tags[1].id },
      { statusId: statuses[1].id, tagId: tags[1].id },
    ]);
    await db.update(entityStatusesTable).set({ primaryTagId: tags[0].id }).where(eq(entityStatusesTable.id, statuses[0].id));
    const formulaFields = (entityId: number) => [
      { entityId, fieldKey: "qty", fieldType: "number", nameJson: { en: "Qty" } },
      { entityId, fieldKey: "price", fieldType: "number", nameJson: { en: "Price" } },
      { entityId, fieldKey: "batch", fieldType: "text", nameJson: { en: "Batch" } },
      { entityId, fieldKey: "amount", fieldType: "function", nameJson: { en: "Amount" }, formulaConfigJson: { expression: "{qty}*{price}", decimals: 2 } },
      { entityId, fieldKey: "once", fieldType: "function", nameJson: { en: "Once" }, formulaConfigJson: {
        expression: "{amount}", groupResult: { enabled: true, fields: [{ scope: "entity" as const, fieldKey: "batch" }] },
      } },
    ];
    await db.insert(entityFieldsTable).values([...formulaFields(entity.id), ...formulaFields(target.id)]);
    await db.insert(pageFieldsTable).values([
      { pageId: page.id, fieldKey: "fee", fieldType: "number", nameJson: { en: "Fee" } },
      { pageId: page.id, fieldKey: "group", fieldType: "text", nameJson: { en: "Group" } },
      { pageId: page.id, fieldKey: "amount", fieldType: "function", nameJson: { en: "Page amount" }, formulaConfigJson: { expression: `{entity:${entity.id}.amount}+{fee}`, decimals: 2 } },
      { pageId: page.id, fieldKey: "once", fieldType: "function", nameJson: { en: "Page once" }, formulaConfigJson: {
        expression: `{page:${page.id}.amount}`, groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "batch" }] },
      } },
    ]);
    const records = await db.insert(entityRecordsTable).values([
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 2, price: 3, batch: "same", amount: 9999 }, createdAt: new Date("2024-01-01") },
      { entityId: entity.id, statusId: statuses[1].id, valuesJson: { qty: 2, price: 5, batch: "same" }, createdAt: new Date("2024-01-02") },
      { entityId: entity.id, statusId: statuses[2].id, valuesJson: { qty: 2, price: 4, batch: "other" }, createdAt: new Date("2024-01-03") },
      { entityId: entity.id, statusId: null, valuesJson: { qty: 1, price: 3, batch: "last" }, createdAt: new Date("2024-01-04") },
      { entityId: entity.id, statusId: statuses[0].id, valuesJson: { qty: 999, price: 999, batch: "same" }, createdAt: new Date("2020-01-01"), archivedAt: new Date() },
    ]).returning();
    await db.insert(pageRecordValuesTable).values(records.map((row, i) => ({
      pageId: page.id, recordId: row.id, valuesJson: { fee: 1, group: i < 2 ? "A" : "B", amount: 9999 },
    })));
    const chart = (extra = {}) => ({
      type: "bar" as const, entityId: entity.id, aggregation: "sum" as const, fieldKey: "amount",
      groupBy: { kind: "statusTag" as const }, ...extra,
    });
    const values = (series: Awaited<ReturnType<typeof computeChartSeries>>) => Object.fromEntries(series.map(bucket => [bucket.label, bucket.value]));
    await t.test("tag overlap, untagged, colors, display flags, status/tag filters, SQL counts/numeric sums", async () => {
      const series = await computeChartSeries(chart());
      assert.deepEqual(values(series), { Alpha: 6, Beta: 16, "Без тега": 11 });
      assert.equal(series[0].color, "#112233");
      assert.deepEqual(values(await computeChartSeries(chart({ aggregation: "count", fieldKey: null }))), { Alpha: 1, Beta: 2, "Без тега": 2 });
      assert.deepEqual(values(await computeChartSeries(chart({ fieldKey: "price" }))), { Alpha: 3, Beta: 8, "Без тега": 7 });
      assert.deepEqual(values(await computeChartSeries(chart({ statusIds: [statuses[1].id], statusTagIds: [tags[0].id] }))), {});
      assert.deepEqual(values(await computeChartSeries(chart({ statusTagIds: tagIds }))), { Alpha: 6, Beta: 16 });
      assert.deepEqual(values(await computeChartSeries(chart({ groupBy: { kind: "status" } }))), { First: 6, Second: 10, Third: 8, "—": 3 });
      assert.deepEqual(values(await computeChartSeries(chart({ groupBy: { kind: "field", fieldKey: "batch" } }))), { same: 16, other: 8, last: 3 });
      assert.deepEqual(values(await computeChartSeries(chart({ aggregation: "count", groupBy: { kind: "status" } }))), { First: 1, Second: 1, Third: 1, "—": 1 });
      assert.deepEqual(values(await computeChartSeries(chart({ fieldKey: "price", groupBy: { kind: "field", fieldKey: "batch" } }))), { same: 8, other: 4, last: 3 });
    });
    await t.test("full-set winners before buckets and tag expansion, including page formulas/chains", async () => {
      assert.deepEqual(values(await computeChartSeries(chart({ fieldKey: "once" }))), { Alpha: 6, Beta: 6, "Без тега": 11 });
      assert.deepEqual(values(await computeChartSeries(chart({ fieldKey: "once", groupBy: { kind: "status" } }))), { First: 6, Second: 0, Third: 8, "—": 3 });
      const pageChart = chart({ source: "page", pageId: page.id });
      assert.deepEqual(values(await computeChartSeries(pageChart)), { Alpha: 7, Beta: 18, "Без тега": 13 });
      assert.deepEqual(values(await computeChartSeries({ ...pageChart, fieldKey: "once" })), { Alpha: 7, Beta: 7, "Без тега": 13 });
      assert.deepEqual(values(await computeChartSeries({ ...pageChart, groupBy: { kind: "field", fieldKey: "group" } })), { A: 18, B: 13 });
      assert.deepEqual(values(await computeChartSeries({ ...pageChart, aggregation: "count", fieldKey: "fee" })), { Alpha: 1, Beta: 2, "Без тега": 2 });
      assert.deepEqual(values(await computeChartSeries({ ...pageChart, fieldKey: "fee", groupBy: { kind: "field", fieldKey: "group" } })), { A: 2, B: 2 });
      assert.equal(await validateChartConfig(pageChart), null);
      assert.equal(await validateChartConfig(chart()), null);
    });
    await t.test("related formula totals repeat per base link after unique-target winner suppression", async () => {
      const [relation] = await db.insert(relationsTable).values({
        relationKey: `${run}_link`, nameJson: { en: "Targets" }, relationType: "many_to_one",
        sourceEntityId: entity.id, targetEntityId: target.id,
      }).returning();
      const targets = await db.insert(entityRecordsTable).values([
        { entityId: target.id, valuesJson: { qty: 2, price: 5, batch: "G", amount: 9999 }, createdAt: new Date("2024-01-01") },
        { entityId: target.id, valuesJson: { qty: 3, price: 5, batch: "G" }, createdAt: new Date("2024-01-02") },
        { entityId: target.id, valuesJson: { qty: 999, price: 999, batch: "G" }, archivedAt: new Date(), createdAt: new Date("2020-01-01") },
      ]).returning();
      await db.insert(recordLinksTable).values(records.slice(0, 4).map((row, i) => ({
        relationId: relation.id, relationType: "many_to_one", sourceRecordId: row.id,
        targetRecordId: targets[i < 2 ? 0 : i - 1].id,
      })));
      const metric = { key: "m", entityId: entity.id, aggregation: "sum" as const, relationId: relation.id, fieldKey: "amount" };
      assert.equal(await validateMetricLike(metric), null);
      assert.equal(await computeMetric(metric), 35);
      assert.equal(await computeMetric({ ...metric, fieldKey: "once" }), 20);
      assert.equal(await computeMetric({ ...metric, fieldKey: "once", statusIds: [statuses[2].id] }), 15);
      const amount = (await db.select().from(entityFieldsTable).where(eq(entityFieldsTable.entityId, target.id))).find(f => f.fieldKey === "amount")!;
      await db.update(entityFieldsTable).set({ formulaConfigJson: { expression: '"not numeric"' } }).where(eq(entityFieldsTable.id, amount.id));
      await assert.rejects(computeMetric(metric), /Cannot sum formula/);
      await db.update(entityFieldsTable).set({ isActive: false }).where(eq(entityFieldsTable.id, amount.id));
      await assert.rejects(computeMetric(metric), /unavailable/);
    });
    await t.test("row rounding and a full universe larger than chart display limit", async () => {
      const extra = await db.insert(entityRecordsTable).values(Array.from({ length: 55 }, (_, i) => ({
        entityId: entity.id, statusId: statuses[0].id,
        valuesJson: { qty: 1, price: 0.335, batch: `extra-${i}` },
      }))).returning({ id: entityRecordsTable.id });
      const buckets = await computeChartSeries(chart({ groupBy: { kind: "field", fieldKey: "batch" } }));
      assert.equal(buckets.length, 50);
      assert.equal(buckets.find(b => b.label.startsWith("extra-"))?.value, 0.34);
      assert.equal(values(await computeChartSeries(chart())).Alpha, 24.7); // 6 + 55 × rounded .34
      await db.delete(entityRecordsTable).where(inArray(entityRecordsTable.id, extra.map(row => row.id)));
    });
    await t.test("runtime strict errors and inactive metadata do not silently become zero", async () => {
      // Use exact selected field rather than mutating an unrelated expression.
      const amount = (await db.select().from(entityFieldsTable).where(eq(entityFieldsTable.entityId, entity.id))).find(f => f.fieldKey === "amount")!;
      for (const expression of ['"text"', "1 / 0", "1 % 0"]) {
        await db.update(entityFieldsTable).set({ formulaConfigJson: { expression } }).where(eq(entityFieldsTable.id, amount.id));
        await assert.rejects(computeChartSeries(chart()), /Cannot sum formula/);
      }
      await db.update(entityFieldsTable).set({ isActive: false }).where(eq(entityFieldsTable.id, amount.id));
      assert.match((await validateChartConfig(chart()))!, /not found/);
      await assert.rejects(computeChartSeries(chart()), /unavailable/);
    });
  } finally {
    if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
    if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    if (tagIds.length) await db.delete(tagsTable).where(inArray(tagsTable.id, tagIds));
    assert.equal((await fingerprint()).fingerprint, identity.fingerprint);
  }
});