import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db, entitiesTable, entityFieldsTable, entityRecordsTable, pagesTable,
  pageFieldsTable, pageRecordValuesTable, rolesTable, usersTable, type RolePermissions,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import recordsRouter from "./records";
import { QueryEntityRecordsResponse } from "@workspace/api-zod";

// Run under scripts/with-validation-lock.sh. Only isolated disposable fixtures.
test("real records query: full filtered totals, pagination, groups and own-scope for entity/page formulas", {
  skip: process.env.RUN_FORMULA_TOTALS_DB !== "1" ||
    process.env.NODE_ENV === "production" || process.env.REPLIT_ENVIRONMENT === "production",
}, async () => {
  const key = `formula_totals_${randomUUID().replaceAll("-", "")}`;
  let entityId: number | undefined, pageId: number | undefined, roleId: number | undefined, userId: number | undefined;
  const app = express();
  app.use(express.json());
  app.use("/api", recordsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    [entityId] = (await db.insert(entitiesTable).values({ entityKey: key, nameJson: { en: key } }).returning()).map(r => r.id);
    [pageId] = (await db.insert(pagesTable).values({
      nameJson: { en: key }, mirrorEntityId: entityId, groupByFieldKey: "batch",
    }).returning()).map(r => r.id);
    const permissions = {
      superAdmin: false, pageIds: [pageId],
      admin: {
        pages: false, entities: false, roles: false, users: false, translations: false,
        events: false, modules: false, googleDrive: false, settings: false,
        automations: false, customFilters: false, columnGroups: false, dataImport: false,
        inboundIntegrations: false, documentGeneration: false,
      },
      records: { [String(entityId)]: { view: true, scope: "own", scopeFieldKeys: ["owner"] } },
    } as RolePermissions;
    [roleId] = (await db.insert(rolesTable).values({ nameJson: { en: key }, permissionsJson: permissions }).returning()).map(r => r.id);
    [userId] = (await db.insert(usersTable).values({
      email: `${key}@example.invalid`, firstName: "Formula", lastName: "Test", roleId,
    }).returning()).map(r => r.id);
    assert.ok(entityId && pageId && roleId && userId);
    const modes = ["sum", "average", "formula"] as const;
    const expression = "{produced}/{planned}*100";
    await db.insert(entityFieldsTable).values([
      ...["produced", "planned"].map(fieldKey => ({ entityId: entityId!, fieldKey, nameJson: { en: fieldKey }, fieldType: "number" as const })),
      { entityId, fieldKey: "batch", nameJson: { en: "Batch" }, fieldType: "text" },
      { entityId, fieldKey: "owner", nameJson: { en: "Owner" }, fieldType: "user" },
      ...modes.map(totalMode => ({
        entityId: entityId!, fieldKey: `percent_${totalMode}`, nameJson: { en: totalMode },
        fieldType: "function" as const, showColumnTotal: true,
        formulaConfigJson: { expression, totalMode, displayAffix: "%" },
      })),
    ]);
    const pageFields = await db.insert(pageFieldsTable).values([
      { pageId, fieldKey: "local_produced", nameJson: { en: "Local" }, fieldType: "number" },
      ...modes.map(totalMode => ({
        pageId: pageId!, fieldKey: `local_${totalMode}`, nameJson: { en: totalMode },
        fieldType: "function" as const, showColumnTotal: true,
        formulaConfigJson: { expression: "{local_produced}/{planned}*100", totalMode, displayAffix: "%" },
      })),
    ]).returning();
    const records = await db.insert(entityRecordsTable).values([
      { entityId, valuesJson: { planned: 100, produced: 100, batch: "a", owner: userId } },
      { entityId, valuesJson: { planned: 900, produced: 90, batch: "a", owner: userId } },
      { entityId, valuesJson: { planned: 100, produced: 50, batch: "b", owner: userId } },
      // Must never enter any aggregate, even when batch matches a visible group.
      { entityId, valuesJson: { planned: 100, produced: 100000, batch: "a", owner: null } },
    ]).returning();
    await db.insert(pageRecordValuesTable).values(records.map((r, i) => ({
      pageId: pageId!, recordId: r.id, valuesJson: { local_produced: [100, 90, 50, 100000][i] },
    })));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const query = async (body: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/entities/${entityId}/records/query`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signToken({ userId: userId!, roleId: roleId! })}` },
        body: JSON.stringify({ pageId, pageSize: 1, page: 1, ...body }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      const parsed = QueryEntityRecordsResponse.parse(result);
      assert.ok(parsed.numericTotals);
      return { ...parsed, numericTotals: parsed.numericTotals, groups: parsed.groups ?? [] };
    };
    const assertTotals = (totals: Record<string, number>, expected: number[]) => {
      modes.forEach((mode, i) => {
        assert.equal(totals[`percent_${mode}`], expected[i]);
        assert.equal(totals[`pf:${pageFields.find(f => f.fieldKey === `local_${mode}`)!.id}`], expected[i]);
      });
    };
    const filters = [{ field: "batch", operator: "eq", value: "a" }];
    const first = await query({ filters });
    assert.equal(first.total, 2);
    assert.equal(first.data.length, 1);
    assertTotals(first.numericTotals, [110, 55, 19]);
    const second = await query({ filters, page: 2 });
    assert.notEqual(first.data[0].id, second.data[0].id);
    assertTotals(second.numericTotals, [110, 55, 19]);
    const grouped = await query({ grouped: true });
    assert.equal(grouped.total, 3);
    assert.equal(grouped.groups.length, 2);
    assertTotals(grouped.groups.find(g => g.key === "a")!.sums, [110, 55, 19]);
    assertTotals(grouped.groups.find(g => g.key === "b")!.sums, [50, 50, 50]);
    const expanded = await query({ grouped: true, groupValue: { value: "a" } });
    assertTotals(expanded.numericTotals, [110, 55, 19]);
    assert.equal(expanded.groups.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    if (pageId) await db.delete(pagesTable).where(eq(pagesTable.id, pageId));
    if (entityId) await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (roleId) await db.delete(rolesTable).where(eq(rolesTable.id, roleId));
  }
});