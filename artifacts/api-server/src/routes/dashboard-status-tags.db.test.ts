import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  entitiesTable,
  entityRecordsTable,
  entityStatusesTable,
  pool,
  statusTagsTable,
  tagsTable,
} from "@workspace/db";
import { computeMetric } from "./dashboard";

const runId = `dashboard-status-tags-${randomUUID()}`;
let entityId: number | undefined;
const tagIds: number[] = [];

after(async () => {
  if (entityId != null) await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (tagIds.length) await db.delete(tagsTable).where(inArray(tagsTable.id, tagIds));
  await pool.end();
});

test("dashboard metric tag filters OR tags, AND status ids, and return zero when no status matches", async () => {
  const [entity] = await db.insert(entitiesTable).values({
    entityKey: `${runId}_entity`,
    nameJson: { en: "Dashboard status tags" },
  }).returning({ id: entitiesTable.id });
  entityId = entity.id;
  const currentEntityId = entity.id;
  const statuses = await db.insert(entityStatusesTable).values([
    { entityId: currentEntityId, statusKey: "overlap", nameJson: { en: "Overlap" }, sortOrder: 1 },
    { entityId: currentEntityId, statusKey: "alpha", nameJson: { en: "Alpha" }, sortOrder: 2 },
    { entityId: currentEntityId, statusKey: "beta", nameJson: { en: "Beta" }, sortOrder: 3 },
  ]).returning({ id: entityStatusesTable.id });
  const tags = await db.insert(tagsTable).values([
    { nameJson: { en: `${runId} alpha` } },
    { nameJson: { en: `${runId} beta` } },
    { nameJson: { en: `${runId} no matches` } },
  ]).returning({ id: tagsTable.id });
  const [alpha, beta, noMatches] = tags.map((tag) => tag.id);
  tagIds.push(alpha!, beta!, noMatches!);
  await db.insert(statusTagsTable).values([
    { statusId: statuses[0]!.id, tagId: alpha! },
    { statusId: statuses[0]!.id, tagId: beta! },
    { statusId: statuses[1]!.id, tagId: alpha! },
    { statusId: statuses[2]!.id, tagId: beta! },
  ]);
  await db.insert(entityRecordsTable).values([
    { entityId: currentEntityId, statusId: statuses[0]!.id, valuesJson: { amount: 10 } },
    { entityId: currentEntityId, statusId: statuses[1]!.id, valuesJson: { amount: 20 } },
    { entityId: currentEntityId, statusId: statuses[2]!.id, valuesJson: { amount: 30 } },
  ]);

  const metric = (aggregation: "count" | "sum", statusTagIds: number[], statusIds?: number[]) =>
    computeMetric({ key: "value", entityId: currentEntityId, aggregation, fieldKey: aggregation === "sum" ? "amount" : null, statusTagIds, statusIds });

  assert.equal(await metric("count", [alpha!]), 2);
  assert.equal(await metric("sum", [alpha!]), 30);
  // The overlap status appears once even though it has both tags; tag ids are an
  // OR filter, not a join that can duplicate aggregate rows.
  assert.equal(await metric("count", [alpha!, beta!]), 3);
  assert.equal(await metric("sum", [alpha!, beta!]), 60);
  assert.equal(await metric("count", [noMatches!]), 0);
  assert.equal(await metric("sum", [noMatches!]), 0);
  // Direct status selection narrows the tag match (AND, never a second OR).
  assert.equal(await metric("count", [alpha!], [statuses[0]!.id]), 1);
  assert.equal(await metric("sum", [alpha!], [statuses[2]!.id]), 0);
});