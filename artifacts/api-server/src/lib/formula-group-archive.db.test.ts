import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { Request } from "express";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable,
  pagesTable, pageFieldsTable, relationsTable, recordLinksTable, rolesTable, usersTable,
  type RolePermissions,
} from "@workspace/db";
import {
  interactiveFormulaPermissions, isDeniedFormulaProjection, materializeVisiblePageFormulas,
  mergeLinkedFormulaInputs, systemFormulaPermissions,
} from "./formula-runtime";
import { linkedFormulaResourceKey } from "./linked-formula-resolver";
import { computePivot } from "../routes/pivot-compute";
import type { RelationFilterMeta } from "../routes/record-query";

after(() => pool.end());

// Only disposable fixtures, under the repository validation lock. No routes
// are invoked: records-query endpoints may trigger a business auto-archive sweep.
test("single-link group projections retain archive parity without widening external aggregates or RBAC", {
  skip: process.env.RUN_FORMULA_GROUP_ARCHIVE_DB !== "1" ||
    process.env.NODE_ENV === "production" || process.env.REPLIT_ENVIRONMENT === "production",
}, async t => {
  const endpoint = new URL(process.env.DATABASE_URL!);
  assert.equal(endpoint.hostname, "helium");
  assert.equal(endpoint.pathname, "/heliumdb");
  const identity = await db.execute(sql`SELECT current_database() AS database,
    md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint FROM entities`);
  assert.equal(identity.rows[0].database, "heliumdb");
  assert.ok(process.env.FORMULA_GROUP_ARCHIVE_DEV_FINGERPRINT, "Confirm the development DB before fixture writes");
  assert.equal(identity.rows[0].fingerprint, process.env.FORMULA_GROUP_ARCHIVE_DEV_FINGERPRINT);

  const key = `group_archive_${randomUUID().replaceAll("-", "")}`;
  const entityIds: number[] = [], pageIds: number[] = [];
  let roleId: number | undefined, userId: number | undefined;
  try {
    const entities = await db.insert(entitiesTable).values(["products", "projects", "orders"].map(part => ({
      entityKey: `${key}_${part}`, nameJson: { en: part }, pivotEnabled: true,
    }))).returning();
    entityIds.push(...entities.map(entity => entity.id));
    const [products, projects, orders] = entities;
    const [page, orderPage] = await db.insert(pagesTable).values([
      { nameJson: { en: key }, mirrorEntityId: products.id },
      { nameJson: { en: `${key}_orders` }, mirrorEntityId: orders.id },
    ]).returning();
    pageIds.push(page.id, orderPage.id);
    const [hiddenStatus] = await db.insert(entityStatusesTable).values({
      entityId: orders.id, statusKey: key, nameJson: { en: "Hidden" },
    }).returning();
    const permissions = {
      superAdmin: false, pageIds: [page.id], admin: {},
      records: {
        [products.id]: { view: true },
        [projects.id]: { view: true },
        [orders.id]: { view: true, scope: "own", scopeFieldKeys: ["owner"], hiddenRowStatusIds: [hiddenStatus.id] },
      },
    } as unknown as RolePermissions;
    [roleId] = (await db.insert(rolesTable).values({
      nameJson: { en: key }, permissionsJson: permissions,
    }).returning()).map(role => role.id);
    [userId] = (await db.insert(usersTable).values({
      email: `${key}@example.invalid`, firstName: "Group", lastName: "Archive", roleId,
    }).returning()).map(user => user.id);
    const req = { user: { userId, roleId } } as Request;

    const [projectRelation, orderRelation] = await db.insert(relationsTable).values([
      { sourceEntityId: products.id, targetEntityId: projects.id, relationKey: `${key}_project`, relationType: "many_to_one" },
      { sourceEntityId: products.id, targetEntityId: orders.id, relationKey: `${key}_order`, relationType: "many_to_one" },
    ]).returning();
    await db.insert(entityFieldsTable).values([
      { entityId: projects.id, fieldKey: "name", fieldType: "text", nameJson: { en: "Name" } },
      { entityId: orders.id, fieldKey: "number", fieldType: "text", nameJson: { en: "Number" } },
      { entityId: orders.id, fieldKey: "amount", fieldType: "number", nameJson: { en: "Amount" } },
      { entityId: orders.id, fieldKey: "owner", fieldType: "user", nameJson: { en: "Owner" } },
      { entityId: orders.id, fieldKey: "secret", fieldType: "text", nameJson: { en: "Secret" }, permissionsJson: { [roleId]: "hidden" } },
    ]);
    await db.insert(pageFieldsTable).values({
      pageId: orderPage.id, fieldKey: "local_secret", fieldType: "text", nameJson: { en: "Private page" },
    });
    const fields = await db.insert(entityFieldsTable).values([
      { entityId: products.id, fieldKey: "project", fieldType: "relation", nameJson: { en: "Project" }, pivotEnabled: true,
        relationConfigJson: { relationId: projectRelation.id, relatedFieldKey: "name" } },
      { entityId: products.id, fieldKey: "order", fieldType: "relation", nameJson: { en: "Order" }, pivotEnabled: true,
        relationConfigJson: { relationId: orderRelation.id, relatedFieldKey: "number" } },
      { entityId: products.id, fieldKey: "secret_link", fieldType: "lookup", nameJson: { en: "Secret link" },
        relationConfigJson: { relationId: orderRelation.id, relatedFieldKey: "secret" } },
      { entityId: products.id, fieldKey: "page_link", fieldType: "lookup", nameJson: { en: "Private page link" },
        relationConfigJson: { relationId: orderRelation.id, relatedFieldKey: "local_secret", relatedPageId: orderPage.id } },
      { entityId: products.id, fieldKey: "quantity", fieldType: "number", nameJson: { en: "Quantity" }, pivotEnabled: true },
      { entityId: products.id, fieldKey: "match_number", fieldType: "text", nameJson: { en: "Match" }, pivotEnabled: true },
    ]).returning();
    const groupResult = { enabled: true, fields: [
      { scope: "entity" as const, fieldKey: "project" }, { scope: "entity" as const, fieldKey: "order" },
    ] };
    const pageFields = await db.insert(pageFieldsTable).values([
      { pageId: page.id, fieldKey: "once", fieldType: "function", nameJson: { en: "Count orders" }, pivotEnabled: true,
        formulaConfigJson: { expression: "1", decimals: 0, groupResult } },
      { pageId: page.id, fieldKey: "rounded_once", fieldType: "function", nameJson: { en: "Rounded" }, pivotEnabled: true,
        formulaConfigJson: { expression: "{quantity}", decimals: 0, groupResult } },
      { pageId: page.id, fieldKey: "external", fieldType: "function", nameJson: { en: "External" }, pivotEnabled: true,
        formulaConfigJson: { expression: "{source:amount}", sources: [{
          key: "source:amount", kind: "aggregate", targetEntityId: orders.id, value: { scope: "entity", fieldKey: "amount" },
          join: { kind: "relation", relationId: orderRelation.id, baseSide: "source" }, aggregate: "sum",
        }, {
          key: "source:equality", kind: "aggregate", targetEntityId: orders.id, value: { scope: "entity", fieldKey: "amount" },
          join: { kind: "equality", on: [{
            base: { scope: "entity", fieldKey: "match_number" }, target: { scope: "entity", fieldKey: "number" },
          }] }, aggregate: "sum",
        }] } },
    ]).returning();
    const archivedAt = new Date("2024-06-01");
    const projectRows = await db.insert(entityRecordsTable).values([
      { entityId: projects.id, valuesJson: { name: "P1" } },
      { entityId: projects.id, valuesJson: { name: "P2" }, archivedAt },
    ]).returning();
    const orderRows = await db.insert(entityRecordsTable).values([
      { entityId: orders.id, valuesJson: { number: "A", amount: 10, owner: userId, secret: "private" } },
      { entityId: orders.id, valuesJson: { number: "B", amount: 20, owner: userId, secret: "private" }, archivedAt },
      { entityId: orders.id, valuesJson: { number: "C", amount: 30, owner: userId, secret: "private" }, archivedAt },
      { entityId: orders.id, valuesJson: { number: "Other owner", owner: null }, archivedAt },
      { entityId: orders.id, valuesJson: { number: "Hidden status", owner: userId }, statusId: hiddenStatus.id, archivedAt },
    ]).returning();
    const definitions = [
      { project: 0, order: 0, archived: false, date: "2024-01-01", quantity: 2.49 },
      { project: 0, order: 0, archived: false, date: "2024-01-02", quantity: 99 },
      { project: 0, order: 1, archived: false, date: "2024-01-03", quantity: 3.51 },
      { project: 0, order: 1, archived: false, date: "2024-01-04", quantity: 99 },
      { project: 1, order: 2, archived: false, date: "2024-01-05", quantity: 5.49 },
      { project: 0, order: 1, archived: true, date: "2023-01-01", quantity: 6.5 },
      { project: 0, order: 1, archived: true, date: "2024-01-06", quantity: 99 },
      { project: 1, order: 2, archived: true, date: "2023-01-02", quantity: 8.51 },
      { project: 1, order: 2, archived: true, date: "2024-01-07", quantity: 99 },
      { project: null, order: null, archived: true, date: "2024-01-08", quantity: 1.51 },
    ];
    const rows = await db.insert(entityRecordsTable).values(definitions.map(definition => ({
      entityId: products.id, valuesJson: { quantity: definition.quantity, match_number: "B" },
      createdAt: new Date(definition.date), archivedAt: definition.archived ? archivedAt : null,
    }))).returning();
    await db.insert(recordLinksTable).values(definitions.flatMap((definition, index) => [
      ...(definition.project == null ? [] : [{
        relationId: projectRelation.id, relationType: "many_to_one", sourceRecordId: rows[index].id,
        targetRecordId: projectRows[definition.project].id,
      }]),
      ...(definition.order == null ? [] : [{
        relationId: orderRelation.id, relationType: "many_to_one", sourceRecordId: rows[index].id,
        targetRecordId: orderRows[definition.order].id,
      }]),
    ]));
    const relationMeta = new Map<string, RelationFilterMeta>([
      ["project", { relationId: projectRelation.id, relatedFieldKey: "name", direction: "source" }],
      ["order", { relationId: orderRelation.id, relatedFieldKey: "number", direction: "source" }],
    ]);

    await t.test("active/archived/all report totals match independent displayed-key winners and JS rounding", async () => {
      for (const mode of ["active", "archived", "all"] as const) {
        const where = and(eq(entityRecordsTable.entityId, products.id), inArray(entityRecordsTable.id, rows.map(row => row.id)),
          mode === "all" ? undefined : mode === "active" ? isNull(entityRecordsTable.archivedAt) : isNotNull(entityRecordsTable.archivedAt))!;
        const adapter = await interactiveFormulaPermissions(req, products.id, page.id, mode !== "active");
        const eligible = definitions.map((definition, index) => ({ ...definition, row: rows[index] }))
          .filter(definition => mode === "all" || definition.archived === (mode === "archived"))
          .sort((a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime() || a.row.id - b.row.id);
        const winners = new Map<string, typeof eligible[number]>();
        for (const definition of eligible) {
          const group = definition.project == null && definition.order == null ? `empty:${definition.row.id}`
            : JSON.stringify([definition.project, definition.order]);
          if (!winners.has(group)) winners.set(group, definition);
        }
        for (const fieldKey of ["once", "rounded_once"]) {
          const expected = new Map<string, number>();
          for (const definition of winners.values()) {
            const project = definition.project == null ? "" : ["P1", "P2"][definition.project];
            expected.set(project, (expected.get(project) ?? 0) + (fieldKey === "once" ? 1 : Math.round(definition.quantity)));
          }
          const result = await computePivot({
            entityId: products.id, pageId: page.id, entityFields: fields, pageFields, relationMeta, where,
            pivot: { rows: { source: "entity", fieldKey: "project" }, measure: { agg: "sum", source: "page", fieldKey } },
            formulaPermissions: adapter,
          });
          assert.ok(result.ok, result.ok ? "" : result.error);
          assert.equal(result.result.grandTotal, [...expected.values()].reduce((sum, value) => sum + value, 0), `${mode} ${fieldKey}`);
          for (const row of result.result.rowTotals) assert.equal(row.value, expected.get(row.key) ?? 0, `${mode} ${fieldKey} ${row.key}`);
        }
      }
    });

    await t.test("mixed graph keeps explicit external amounts active-only and source tokens off the wire", async () => {
      const inputs = await mergeLinkedFormulaInputs({
        entityId: products.id, pageId: page.id, rows: rows.slice(0, 5).map(row => ({ id: row.id, values: row.valuesJson as Record<string, unknown> })),
        fields: [...fields, ...pageFields], permissions: await interactiveFormulaPermissions(req, products.id, page.id),
        formulaOptions: { throwOnError: true },
      });
      assert.equal(inputs.get(rows[2].id)!.order, "B", "active base with archived order retains its group key");
      assert.equal(inputs.get(rows[4].id)!.project, "P2", "archived project retains its displayed group key");
      assert.equal(inputs.get(rows[0].id)!["source:amount"], 10);
      assert.equal(inputs.get(rows[2].id)!["source:amount"], 0);
      assert.equal(inputs.get(rows[4].id)!["source:amount"], 0);
      assert.equal(isDeniedFormulaProjection(inputs.get(rows[2].id), "source:amount"), false, "archive exclusion is not a denial");
      assert.equal(inputs.get(rows[2].id)!["source:equality"], 0);
      assert.equal(isDeniedFormulaProjection(inputs.get(rows[2].id), "source:equality"), false, "loaded archived group targets never deny external equality sources");
      const values = materializeVisiblePageFormulas({
        entityId: products.id, pageId: page.id, rows: rows.slice(0, 5).map(row => ({ id: row.id, entityValues: row.valuesJson as Record<string, unknown>, pageValues: {} })),
        entityFields: fields, pageFields, hiddenEntity: new Set(), hiddenPage: new Set(), linkedInputs: inputs,
      });
      assert.equal(values.get(rows[2].id)!.external, 0);
      assert.equal("source:amount" in values.get(rows[2].id)!, false);
      assert.equal("order" in values.get(rows[2].id)!, false);
      assert.equal("includeArchivedTargets" in values.get(rows[2].id)!, false);
    });

    await t.test("archived projections reapply own/status/field/page/entity boundaries", async () => {
      const securityRows = await db.insert(entityRecordsTable).values([3, 4].map(() => ({
        entityId: products.id, valuesJson: {},
      }))).returning();
      await db.insert(recordLinksTable).values(securityRows.map((row, index) => ({
        relationId: orderRelation.id, relationType: "many_to_one", sourceRecordId: row.id, targetRecordId: orderRows[index + 3].id,
      })));
      const groupField = (fieldKey: string) => ({
        fieldKey: "security_once", fieldType: "function",
        formulaConfigJson: { expression: "1", groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey }] } },
      });
      const adapter = await interactiveFormulaPermissions(req, products.id, page.id);
      const ownStatus = await mergeLinkedFormulaInputs({
        entityId: products.id, pageId: page.id, rows: securityRows.map(row => ({ id: row.id, values: row.valuesJson as Record<string, unknown> })),
        fields: [...fields, groupField("order")], permissions: adapter, formulaOptions: { throwOnError: true },
      });
      for (const row of securityRows) {
        assert.equal(ownStatus.get(row.id)!.order, null);
        assert.equal(isDeniedFormulaProjection(ownStatus.get(row.id), "order"), true);
      }
      for (const fieldKey of ["secret_link", "page_link"]) {
        const hidden = await mergeLinkedFormulaInputs({
          entityId: products.id, pageId: page.id, rows: [{ id: rows[2].id, values: {} }],
          fields: [...fields, groupField(fieldKey)], permissions: adapter,
        });
        assert.equal(hidden.get(rows[2].id)![fieldKey], undefined);
        assert.equal(isDeniedFormulaProjection(hidden.get(rows[2].id), fieldKey), true);
      }
      const entityDenied = await mergeLinkedFormulaInputs({
        entityId: products.id, rows: [{ id: rows[2].id, values: {} }], fields: [...fields, groupField("order")],
        permissions: {
          ...systemFormulaPermissions,
          async authorizeResources(resources) {
            return new Set(resources.filter(resource => resource.kind !== "entity" || resource.entityId !== orders.id).map(linkedFormulaResourceKey));
          },
        },
      });
      assert.equal(entityDenied.get(rows[2].id)!.order, undefined);
      assert.equal(isDeniedFormulaProjection(entityDenied.get(rows[2].id), "order"), true);
    });
  } finally {
    if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
    if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (roleId) await db.delete(rolesTable).where(eq(rolesTable.id, roleId));
  }
});