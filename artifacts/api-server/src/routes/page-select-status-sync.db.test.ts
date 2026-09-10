import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogTable,
  db,
  deletedFilesTable,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  entityStatusesTable,
  entityTransitionsTable,
  pageFieldsTable,
  pageRecordValuesTable,
  pagesTable,
  recordLinksTable,
  relationsTable,
  rolesTable,
  systemEventsTable,
  usersTable,
  userRolesTable,
  mirrorPermKey,
  type RolePermissions,
} from "@workspace/db";
import { signToken } from "../lib/jwt";
import pageFieldsRouter from "./page-fields";
import recordsRouter from "./records";

const runId = `page-select-sync-${randomUUID()}`;
const ids: Record<string, number> = {};
const app = express();
app.use(express.json());
app.use("/api", pageFieldsRouter);
app.use("/api", recordsRouter);

function permissions(
  pageIds: number[],
  hiddenStatusIds: number[] = [],
  hiddenRowStatusIds: number[] = [],
): RolePermissions {
  return {
    superAdmin: false,
    admin: {
      pages: false, entities: false, roles: false, users: false, translations: false,
      events: false, modules: false, googleDrive: false, settings: false,
      automations: false, customFilters: false, columnGroups: false, dataImport: false,
      inboundIntegrations: false, documentGeneration: false,
    },
    pageIds,
    records: {
      [String(ids.entity)]: {
        view: true, create: true, update: true, delete: true,
        ...(hiddenStatusIds.length ? { hiddenStatusIds } : {}),
        ...(hiddenRowStatusIds.length ? { hiddenRowStatusIds } : {}),
      },
      ...(ids.relatedEntity
        ? { [String(ids.relatedEntity)]: { view: true, create: false, update: false, delete: false } }
        : {}),
    },
  };
}

async function request(
  path: string,
  body: unknown,
  method: "POST" | "PUT",
  roleId = ids.role,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${signToken({ userId: ids.user, roleId })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: Record<string, unknown>;
    if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { responseText: text, responseParseError: "Invalid JSON response" };
      }
    } else {
      parsed = { responseText: text };
    }
    return { status: response.status, body: parsed };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function read(path: string): Promise<{ status: number; body: unknown }> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      headers: { authorization: `Bearer ${signToken({ userId: ids.user, roleId: ids.role })}` },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function pageValue(pageId: number, recordId: number) {
  const [row] = await db.select().from(pageRecordValuesTable).where(and(
    eq(pageRecordValuesTable.pageId, pageId), eq(pageRecordValuesTable.recordId, recordId),
  ));
  return row;
}

async function record(recordId: number) {
  const [row] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId));
  assert.ok(row);
  return row;
}

async function rollbackSnapshot(recordId: number) {
  const row = await record(recordId);
  const [pageRow] = await db.select().from(pageRecordValuesTable).where(and(
    eq(pageRecordValuesTable.pageId, ids.targetPage),
    eq(pageRecordValuesTable.recordId, recordId),
  ));
  const [audits, events, deletedFiles] = await Promise.all([
    db.select().from(auditLogTable).where(eq(auditLogTable.recordId, recordId)),
    db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, recordId)),
    db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, recordId)),
  ]);
  return {
    valuesJson: row.valuesJson,
    statusId: row.statusId,
    archivedAt: row.archivedAt,
    version: row.version,
    pageRow,
    audits,
    events,
    deletedFiles,
  };
}

async function pageRefRollbackSnapshot(recordId: number) {
  const row = await record(recordId);
  const [sourceRow, targetRow, audits, events, deletedFiles] = await Promise.all([
    pageValue(ids.sourcePage, recordId),
    pageValue(ids.targetPage, recordId),
    db.select().from(auditLogTable).where(eq(auditLogTable.recordId, recordId)),
    db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, recordId)),
    db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, recordId)),
  ]);
  return {
    valuesJson: row.valuesJson,
    statusId: row.statusId,
    archivedAt: row.archivedAt,
    version: row.version,
    sourceRow,
    targetRow,
    audits,
    events,
    deletedFiles,
  };
}

function assertPageRefDenialRedacted(response: { status: number; body: Record<string, unknown> }) {
  assert.equal(response.status, 403);
  const error = String(response.body.error);
  assert.ok(!error.includes(String(ids.sourcePage)), "must not expose source page id");
  assert.ok(!error.includes(`${runId} source`), "must not expose source page name");
  assert.ok(!error.includes('"stage"'), "must not expose source field key");
}

async function reset(recordIds = [ids.one, ids.two]) {
  await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
  await db.delete(auditLogTable).where(inArray(auditLogTable.recordId, recordIds));
  await db.delete(systemEventsTable).where(and(eq(systemEventsTable.entityId, ids.entity), inArray(systemEventsTable.recordId, recordIds)));
  await db.delete(deletedFilesTable).where(inArray(deletedFilesTable.recordId, recordIds));
  await db.update(entityRecordsTable).set({
    statusId: ids.base,
    archivedAt: null,
    valuesJson: {
      name: "Ready",
      owner: ids.user,
      attachment: { kind: "server", path: `/local/${runId}.txt`, name: "old.txt" },
    },
  }).where(inArray(entityRecordsTable.id, recordIds));
  await db.delete(pageRecordValuesTable).where(inArray(pageRecordValuesTable.recordId, recordIds));
}

async function setup() {
  const [entity] = await db.insert(entitiesTable).values({ entityKey: runId, nameJson: { en: runId } })
    .returning({ id: entitiesTable.id });
  ids.entity = entity!.id;
  const [relatedEntity] = await db.insert(entitiesTable).values({
    entityKey: `${runId}-related`,
    nameJson: { en: `${runId} related` },
  }).returning({ id: entitiesTable.id });
  ids.relatedEntity = relatedEntity!.id;
  const pages = await db.insert(pagesTable).values([
    { nameJson: { en: `${runId} target` }, mirrorEntityId: ids.entity },
    { nameJson: { en: `${runId} source` }, mirrorEntityId: ids.entity },
    { nameJson: { en: `${runId} related source` }, mirrorEntityId: ids.relatedEntity },
  ]).returning({ id: pagesTable.id });
  ids.targetPage = pages[0]!.id;
  ids.sourcePage = pages[1]!.id;
  ids.relatedPage = pages[2]!.id;
  const [role] = await db.insert(rolesTable).values({
    nameJson: { en: runId },
    permissionsJson: permissions([ids.targetPage, ids.sourcePage]),
  }).returning({ id: rolesTable.id });
  ids.role = role!.id;
  const [user] = await db.insert(usersTable).values({
    email: `${runId}@example.invalid`, firstName: "Page", lastName: "Writer", roleId: ids.role,
  }).returning({ id: usersTable.id });
  ids.user = user!.id;
  await db.insert(entityFieldsTable).values([
    { entityId: ids.entity, fieldKey: "name", nameJson: { en: "Name" }, fieldType: "text", isRequired: true },
    { entityId: ids.entity, fieldKey: "owner", nameJson: { en: "Owner" }, fieldType: "user" },
    { entityId: ids.entity, fieldKey: "attachment", nameJson: { en: "Attachment" }, fieldType: "file" },
    { entityId: ids.entity, fieldKey: "workflow_note", nameJson: { en: "Workflow note" }, fieldType: "text" },
  ]);
  await db.insert(entityFieldsTable).values({
    entityId: ids.relatedEntity,
    fieldKey: "name",
    nameJson: { en: "Name" },
    fieldType: "text",
  });
  await db.insert(entityFieldsTable).values({
    entityId: ids.relatedEntity,
    fieldKey: "owner",
    nameJson: { en: "Owner" },
    fieldType: "user",
  });
  const statuses = await db.insert(entityStatusesTable).values([
    { entityId: ids.entity, statusKey: "base", nameJson: { en: "Base" }, isDefault: true, sortOrder: 0 },
    { entityId: ids.entity, statusKey: "done", nameJson: { en: "Done" }, sortOrder: 1 },
    { entityId: ids.entity, statusKey: "archive", nameJson: { en: "Archive" }, isArchiveTrigger: true, archiveAfterDays: 0, sortOrder: 2 },
  ]).returning({ id: entityStatusesTable.id, statusKey: entityStatusesTable.statusKey });
  for (const status of statuses) ids[status.statusKey] = status.id;
  await db.insert(entityFieldsTable).values({
    entityId: ids.entity,
    fieldKey: "mapped_stage",
    nameJson: { en: "Mapped stage" },
    fieldType: "select",
    optionsJson: [{ value: "done", labelJson: { en: "Done" }, statusId: ids.done }],
  });
  await db.insert(pageFieldsTable).values([
    {
      pageId: ids.targetPage, fieldKey: "stage", nameJson: { en: "Stage" }, fieldType: "select",
      optionsJson: [{ value: "done", labelJson: { en: "Done" }, statusId: ids.done }, { value: "archive", labelJson: { en: "Archive" }, statusId: ids.archive }],
    },
    {
      pageId: ids.targetPage, fieldKey: "source_stage", nameJson: { en: "Source stage" }, fieldType: "page_ref",
      pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "stage" },
    },
    {
      pageId: ids.sourcePage, fieldKey: "stage", nameJson: { en: "Stage" }, fieldType: "select",
      optionsJson: [{ value: "done", labelJson: { en: "Done" }, statusId: ids.done }],
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "export_value",
      nameJson: { en: "Export value" },
      fieldType: "text",
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "unrelated_value",
      nameJson: { en: "Unrelated value" },
      fieldType: "text",
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "export_chain",
      nameJson: { en: "Export chain" },
      fieldType: "function",
      formulaConfigJson: { expression: "{export_value}" },
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "formula_name",
      nameJson: { en: "Formula name" },
      fieldType: "function",
      formulaConfigJson: { expression: `{entity:${ids.entity}.name}` },
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "projection_leaf",
      nameJson: { en: "Projection leaf" },
      fieldType: "function",
      formulaConfigJson: { expression: "6" },
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "projection_branch",
      nameJson: { en: "Projection branch" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.targetPage}.projection_middle}` },
    },
    {
      pageId: ids.sourcePage,
      fieldKey: "cycle_source",
      nameJson: { en: "Cycle source" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.targetPage}.cycle_target}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "formula_ref",
      nameJson: { en: "Formula ref" },
      fieldType: "page_ref",
      pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "formula_name" },
      isFilterable: true,
      showInTable: false,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "independent_cycle_ref",
      nameJson: { en: "Independent cycle ref" },
      fieldType: "page_ref",
      pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "cycle_source" },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "same_page_formula",
      nameJson: { en: "Same page formula" },
      fieldType: "function",
      formulaConfigJson: { expression: "{stage}" },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "external_formula",
      nameJson: { en: "External formula" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.export_value}` },
      isFilterable: true,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "unrelated_formula",
      nameJson: { en: "Unrelated formula" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.unrelated_value}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "external_chain_formula",
      nameJson: { en: "External chain formula" },
      fieldType: "function",
      isFilterable: true,
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.export_chain}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "filter_formula",
      nameJson: { en: "Filter formula" },
      fieldType: "function",
      formulaConfigJson: { expression: `{entity:${ids.entity}.name}` },
      isFilterable: true,
      showInTable: false,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "customer_formula",
      nameJson: { en: "Customer formula" },
      fieldType: "function",
      formulaConfigJson: { expression: `{entity:${ids.entity}.owner}` },
      isFilterable: true,
      showInTable: false,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "customer_math",
      nameJson: { en: "Customer arithmetic" },
      fieldType: "function",
      formulaConfigJson: { expression: `{entity:${ids.entity}.owner} + 1` },
      isFilterable: true,
      showInTable: false,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "disabled_filter_formula",
      nameJson: { en: "Disabled filter formula" },
      fieldType: "function",
      formulaConfigJson: { expression: `{entity:${ids.entity}.name}` },
      isFilterable: false,
      showInTable: false,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "customer",
      nameJson: { en: "Customer" },
      fieldType: "relation",
      relationConfigJson: { relationId: 0, relatedFieldKey: "name" },
      isFilterable: true,
      showInTable: false,
    },
    {
      pageId: ids.targetPage,
      fieldKey: "projection_middle",
      nameJson: { en: "Projection middle" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.projection_leaf}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "projection_left",
      nameJson: { en: "Projection left" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.projection_branch}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "projection_right",
      nameJson: { en: "Projection right" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.projection_leaf}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "cycle_target",
      nameJson: { en: "Cycle target" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.cycle_source}` },
    },
    {
      pageId: ids.targetPage,
      fieldKey: "cycle_result",
      nameJson: { en: "Cycle result" },
      fieldType: "function",
      formulaConfigJson: { expression: `{page:${ids.sourcePage}.cycle_source}` },
    },
  ]);
  const records = await db.insert(entityRecordsTable).values([
    { entityId: ids.entity, valuesJson: { name: "Ready", owner: ids.user, attachment: { kind: "server", path: `/local/${runId}.txt`, name: "old.txt" } }, statusId: ids.base },
    { entityId: ids.entity, valuesJson: { name: "Ready", owner: ids.user, attachment: { kind: "server", path: `/local/${runId}-2.txt`, name: "old2.txt" } }, statusId: ids.base },
  ]).returning({ id: entityRecordsTable.id });
  ids.one = records[0]!.id; ids.two = records[1]!.id;
  const [relatedRecord] = await db.insert(entityRecordsTable).values({
    entityId: ids.relatedEntity,
    valuesJson: { name: "לקוח Договор", owner: ids.user },
  }).returning({ id: entityRecordsTable.id });
  ids.relatedRecord = relatedRecord!.id;
  const [relation] = await db.insert(relationsTable).values({
    sourceEntityId: ids.entity,
    targetEntityId: ids.relatedEntity,
    relationKey: `${runId}-customer`,
    relationType: "many_to_one",
    nameJson: { en: "Customer" },
    inverseNameJson: { en: "Records" },
  }).returning({ id: relationsTable.id });
  ids.relation = relation!.id;
  await db.update(pageFieldsTable)
    .set({ relationConfigJson: { relationId: ids.relation, relatedFieldKey: "name" } })
    .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "customer")));
  await db.insert(pageFieldsTable).values([
    {
      pageId: ids.relatedPage,
      fieldKey: "related_cost",
      nameJson: { en: "Related cost" },
      fieldType: "number",
    },
    {
      pageId: ids.targetPage,
      fieldKey: "related_cost_formula",
      nameJson: { en: "Related cost formula" },
      fieldType: "function",
      isFilterable: true,
      formulaConfigJson: {
        expression: "{source:related_cost}",
        sources: [{
          key: "source:related_cost",
          kind: "aggregate",
          targetEntityId: ids.relatedEntity,
          targetPageId: ids.relatedPage,
          value: { scope: "page", pageId: ids.relatedPage, fieldKey: "related_cost" },
          join: { kind: "relation", relationId: ids.relation, baseSide: "source" },
          aggregate: "min",
          limit: 1,
        }],
      },
    },
  ]);
  await db.insert(recordLinksTable).values({
    relationId: ids.relation,
    relationType: "many_to_one",
    sourceRecordId: ids.one,
    targetRecordId: ids.relatedRecord,
  });
}

async function cleanup() {
  const entityIds = [ids.entity, ids.relatedEntity].filter((id): id is number => Number.isInteger(id));
  const pageIds = [
    ids.targetPage,
    ids.sourcePage,
    ids.relatedPage,
    ids.formulaAliasPage,
  ].filter((id): id is number => Number.isInteger(id));
  const roleIds = [ids.role, ids.formulaExportRole].filter((id): id is number => Number.isInteger(id));

  if (entityIds.length) {
    await db.delete(systemEventsTable).where(inArray(systemEventsTable.entityId, entityIds));
    await db.delete(auditLogTable).where(inArray(auditLogTable.entityId, entityIds));
    await db.delete(deletedFilesTable).where(inArray(deletedFilesTable.entityId, entityIds));
  }
  if (ids.user && roleIds.length) {
    await db.delete(userRolesTable).where(and(
      eq(userRolesTable.userId, ids.user),
      inArray(userRolesTable.roleId, roleIds),
    ));
  }
  // Pages are not hard-linked to mirror entities, so every page created by this
  // suite must be removed explicitly before its owning entity is deleted.
  if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
  if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
  if (ids.user) await db.delete(usersTable).where(eq(usersTable.id, ids.user));
  if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));

  const [
    remainingPages,
    remainingPageFields,
    remainingEntities,
    remainingRecords,
    remainingRoles,
    remainingUsers,
    remainingRelations,
    remainingLinks,
  ] = await Promise.all([
    pageIds.length
      ? db.select({ id: pagesTable.id }).from(pagesTable).where(inArray(pagesTable.id, pageIds))
      : Promise.resolve([]),
    pageIds.length
      ? db.select({ id: pageFieldsTable.id }).from(pageFieldsTable).where(inArray(pageFieldsTable.pageId, pageIds))
      : Promise.resolve([]),
    entityIds.length
      ? db.select({ id: entitiesTable.id }).from(entitiesTable).where(inArray(entitiesTable.id, entityIds))
      : Promise.resolve([]),
    entityIds.length
      ? db.select({ id: entityRecordsTable.id }).from(entityRecordsTable).where(inArray(entityRecordsTable.entityId, entityIds))
      : Promise.resolve([]),
    roleIds.length
      ? db.select({ id: rolesTable.id }).from(rolesTable).where(inArray(rolesTable.id, roleIds))
      : Promise.resolve([]),
    ids.user
      ? db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, ids.user))
      : Promise.resolve([]),
    ids.relation
      ? db.select({ id: relationsTable.id }).from(relationsTable).where(eq(relationsTable.id, ids.relation))
      : Promise.resolve([]),
    ids.relation
      ? db.select({ id: recordLinksTable.id }).from(recordLinksTable).where(eq(recordLinksTable.relationId, ids.relation))
      : Promise.resolve([]),
  ]);
  assert.deepEqual({
    pages: remainingPages.length,
    pageFields: remainingPageFields.length,
    entities: remainingEntities.length,
    records: remainingRecords.length,
    roles: remainingRoles.length,
    users: remainingUsers.length,
    relations: remainingRelations.length,
    recordLinks: remainingLinks.length,
  }, {
    pages: 0,
    pageFields: 0,
    entities: 0,
    records: 0,
    roles: 0,
    users: 0,
    relations: 0,
    recordLinks: 0,
  }, "suite cleanup must remove every fixture identified by its captured id");
}

after(async () => { await cleanup(); });

test("page-local select mappings synchronize entity status atomically", async (t) => {
  await setup();
  await t.test("page-field format inheritance persists across create, reload, change, and clear", async () => {
    const normalPermissions = permissions([ids.targetPage, ids.sourcePage]);
    await db.update(rolesTable).set({
      permissionsJson: { ...normalPermissions, superAdmin: true },
    }).where(eq(rolesTable.id, ids.role));

    const ownRule = { operator: "equals" as const, value: "Ready", cellColor: "#123456" };
    const pageRule = { operator: "equals" as const, value: "Page source", cellColor: "#234567" };
    const entityRule = { operator: "equals" as const, value: "Entity source", cellColor: "#345678" };
    try {
      await db.update(pageFieldsTable)
        .set({ formatRulesJson: [pageRule] })
        .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      await db.update(entityFieldsTable)
        .set({ formatRulesJson: [entityRule] })
        .where(and(eq(entityFieldsTable.entityId, ids.entity), eq(entityFieldsTable.fieldKey, "workflow_note")));

      const created = await request(
        `/pages/${ids.targetPage}/fields`,
        {
          fieldKey: "inherited_format_regression",
          nameJson: { en: "Inherited format regression" },
          fieldType: "text",
          formulaExportRoleIds: [ids.role],
          formatRulesJson: [ownRule],
          formatInheritJson: [{ kind: "pageField", pageId: ids.sourcePage, fieldKey: "stage" }],
        },
        "POST",
      );
      assert.equal(created.status, 201);
      const createdId = Number(created.body.id);
      assert.ok(Number.isInteger(createdId));
      assert.deepEqual(created.body.formatRulesJson, [ownRule]);
      assert.deepEqual(created.body.inheritedFormatRulesJson, [pageRule]);
      assert.deepEqual(created.body.formulaExportRoleIds, [ids.role]);

      let reloaded = await read(`/pages/${ids.targetPage}/fields`);
      assert.equal(reloaded.status, 200);
      let field = (reloaded.body as Array<Record<string, unknown>>).find((row) => row.id === createdId);
      assert.ok(field);
      assert.deepEqual(field.formatRulesJson, [ownRule]);
      assert.deepEqual(field.formatInheritJson, [{ kind: "pageField", pageId: ids.sourcePage, fieldKey: "stage" }]);
      assert.deepEqual(field.inheritedFormatRulesJson, [pageRule]);
      assert.deepEqual(field.formulaExportRoleIds, [ids.role]);

      const [storedAfterCreate] = await db.select({
        formatRulesJson: pageFieldsTable.formatRulesJson,
        formatInheritJson: pageFieldsTable.formatInheritJson,
        formulaExportRoleIds: pageFieldsTable.formulaExportRoleIds,
      }).from(pageFieldsTable).where(eq(pageFieldsTable.id, createdId));
      assert.deepEqual(storedAfterCreate?.formatRulesJson, [ownRule]);
      assert.deepEqual(storedAfterCreate?.formatInheritJson, [
        { kind: "pageField", pageId: ids.sourcePage, fieldKey: "stage" },
      ]);
      assert.deepEqual(storedAfterCreate?.formulaExportRoleIds, [ids.role]);

      const changed = await request(
        `/page-fields/${createdId}`,
        {
          formatInheritJson: [{ kind: "field", entityId: ids.entity, fieldKey: "workflow_note" }],
          formulaExportRoleIds: [],
        },
        "PUT",
      );
      assert.equal(changed.status, 200);
      assert.deepEqual(changed.body.formatRulesJson, [ownRule]);
      assert.deepEqual(changed.body.inheritedFormatRulesJson, [entityRule]);
      assert.deepEqual(changed.body.formulaExportRoleIds, []);

      const cleared = await request(`/page-fields/${createdId}`, { formatInheritJson: [] }, "PUT");
      assert.equal(cleared.status, 200);
      assert.deepEqual(cleared.body.formatRulesJson, [ownRule]);
      assert.deepEqual(cleared.body.formatInheritJson, []);
      assert.deepEqual(cleared.body.inheritedFormatRulesJson, []);

      reloaded = await read(`/pages/${ids.targetPage}/fields`);
      assert.equal(reloaded.status, 200);
      field = (reloaded.body as Array<Record<string, unknown>>).find((row) => row.id === createdId);
      assert.ok(field);
      assert.deepEqual(field.formatRulesJson, [ownRule]);
      assert.deepEqual(field.formatInheritJson, []);
      assert.deepEqual(field.inheritedFormatRulesJson, []);

      const [storedAfterClear] = await db.select({
        formatRulesJson: pageFieldsTable.formatRulesJson,
        formatInheritJson: pageFieldsTable.formatInheritJson,
      }).from(pageFieldsTable).where(eq(pageFieldsTable.id, createdId));
      assert.deepEqual(storedAfterClear?.formatRulesJson, [ownRule]);
      assert.deepEqual(storedAfterClear?.formatInheritJson, []);
    } finally {
      await db.update(rolesTable).set({ permissionsJson: normalPermissions }).where(eq(rolesTable.id, ids.role));
    }
  });

  await t.test("computed page filters require opt-in and narrow total before pagination while hidden from table", async () => {
    await reset();
    await db.update(entityRecordsTable)
      .set({ valuesJson: { name: "Other", owner: ids.user } })
      .where(eq(entityRecordsTable.id, ids.one));
    await db.update(entityRecordsTable)
      .set({ valuesJson: { name: "Договор ירושלים", owner: ids.user } })
      .where(eq(entityRecordsTable.id, ids.two));

    let response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 1,
        pageLocalFilters: [{ field: "disabled_filter_formula", operator: "in", value: ["Договор ירושלים"] }],
      },
      "POST",
    );
    assert.equal(response.status, 400);

    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 1,
        pageLocalFilters: [{ field: "filter_formula", operator: "in", value: ["Договор ירושלים"] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 1);
    assert.deepEqual((response.body.data as { id: number }[]).map((row) => row.id), [ids.two]);

    response = await request(
      `/entities/${ids.entity}/records/page-filter-values`,
      {
        pageId: ids.targetPage,
        field: "filter_formula",
        valueSearch: "ירושלים",
      },
      "POST",
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.values, ["Договор ירושלים"]);

    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        filters: [{ field: "name", operator: "eq", value: "missing" }],
        pageLocalFilters: [{ field: "customer", operator: "is_empty" }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 0);

    for (const malformed of [
      { field: "filter_formula", operator: "gt" },
      { field: "filter_formula", operator: "in", value: "x" },
      { field: "filter_formula", operator: "between", value: ["x"] },
    ]) {
      response = await request(
        `/entities/${ids.entity}/records/query`,
        { pageId: ids.targetPage, page: 1, pageSize: 10, pageLocalFilters: [malformed] },
        "POST",
      );
      assert.equal(response.status, 400);
    }

    await db.update(entityRecordsTable).set({ archivedAt: new Date() }).where(eq(entityRecordsTable.id, ids.two));
    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        archived: "all",
        pageLocalFilters: [{ field: "filter_formula", operator: "in", value: ["Договор ירושלים"] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 1);
    await reset();
  });
  await t.test("direct user formulas use stable ids with directory labels while numeric formulas remain numeric", async () => {
    await reset();
    await db.update(usersTable).set({ firstName: "לקוח", lastName: "Клиент" }).where(eq(usersTable.id, ids.user));

    let response = await request(
      `/entities/${ids.entity}/records/page-filter-values`,
      {
        pageId: ids.targetPage,
        field: "customer_formula",
        valueSearch: "кли",
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const values = response.body.values as string[];
    assert.equal(values.length, 1);
    const selected = values[0]!;
    assert.ok(selected.startsWith(`__linked__:${ids.user}:`));
    assert.equal(decodeURIComponent(selected.slice(selected.lastIndexOf(":") + 1)), "לקוח Клиент");

    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "customer_formula", operator: "in", value: [selected] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 2);

    await db.update(usersTable).set({ firstName: "Renamed", lastName: "Customer" }).where(eq(usersTable.id, ids.user));
    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "customer_formula", operator: "in", value: [selected] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 2, "a renamed user must not invalidate an old selected token");

    response = await request(
      `/entities/${ids.entity}/records/page-filter-values`,
      { pageId: ids.targetPage, field: "customer_math" },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.values, [String(ids.user + 1)]);
    await db.update(usersTable).set({ firstName: "Page", lastName: "Writer" }).where(eq(usersTable.id, ids.user));
  });
  await t.test("page_ref filter reapplies source field boundary", async () => {
    await reset();
    let response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "formula_ref", operator: "in", value: ["Ready"] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 2);

    await db.update(pageFieldsTable)
      .set({ permissionsJson: { [String(ids.role)]: "hidden" } })
      .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "formula_name")));
    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "formula_ref", operator: "in", value: ["Ready"] }],
      },
      "POST",
    );
    assert.equal(response.status, 400);
    await db.update(pageFieldsTable)
      .set({ permissionsJson: {} })
      .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "formula_name")));

    await db.update(rolesTable)
      .set({ permissionsJson: permissions([ids.targetPage]) })
      .where(eq(rolesTable.id, ids.role));
    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "formula_ref", operator: "in", value: ["Ready"] }],
      },
      "POST",
    );
    assert.equal(response.status, 400);

    const sourceOwn = permissions([ids.targetPage, ids.sourcePage]);
    sourceOwn.records[mirrorPermKey(ids.sourcePage)] = {
      view: true, create: false, update: false, delete: false, scope: "own", scopeFieldKeys: ["owner"],
    };
    await db.update(rolesTable).set({ permissionsJson: sourceOwn }).where(eq(rolesTable.id, ids.role));
    await db.update(entityRecordsTable)
      .set({ valuesJson: { name: "Ready", owner: null } })
      .where(eq(entityRecordsTable.id, ids.one));
    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "formula_ref", operator: "in", value: ["Ready"] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 1);
    assert.deepEqual((response.body.data as { id: number }[]).map((row) => row.id), [ids.two]);
    await db.update(rolesTable)
      .set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
      .where(eq(rolesTable.id, ids.role));
    await reset();
  });
  await t.test("relation filter resolves without formula references and searches Unicode label", async () => {
    await reset();
    let response = await request(
      `/entities/${ids.entity}/records/page-filter-values`,
      {
        pageId: ids.targetPage,
        field: "customer",
        valueSearch: "לקוח",
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const values = response.body.values as string[];
    assert.equal(values.length, 1);
    const linked = values.find((value) => value.startsWith(`__linked__:${ids.relatedRecord}:`));
    assert.ok(linked);

    response = await request(
      `/entities/${ids.entity}/records/query`,
      {
        pageId: ids.targetPage,
        page: 1,
        pageSize: 10,
        pageLocalFilters: [{ field: "customer", operator: "in", value: [linked] }],
      },
      "POST",
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.total, 1);
    assert.deepEqual((response.body.data as { id: number }[]).map((row) => row.id), [ids.one]);
  });
  await t.test("read-time page formulas and formula page_ref need no source value row", async () => {
    await reset([ids.one]);
    assert.equal(await pageValue(ids.targetPage, ids.one), undefined);
    assert.equal(await pageValue(ids.sourcePage, ids.one), undefined);
    let response = await read(`/pages/${ids.targetPage}/record-values`);
    assert.equal(response.status, 200);
    let rows = response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>;
    let row = rows.find((candidate) => candidate.recordId === ids.one);
    assert.ok(row);
    assert.equal(row.valuesJson.formula_ref, "Ready");
    assert.equal(row.valuesJson.same_page_formula, null);
    assert.equal(await pageValue(ids.targetPage, ids.one), undefined, "target formula projection must remain unpersisted");
    assert.equal(await pageValue(ids.sourcePage, ids.one), undefined, "formula projection must remain unpersisted");

    await db.insert(pageRecordValuesTable).values({
      pageId: ids.targetPage,
      recordId: ids.one,
      valuesJson: { stage: "done" },
    });
    response = await read(`/pages/${ids.targetPage}/record-values`);
    rows = response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>;
    row = rows.find((candidate) => candidate.recordId === ids.one);
    assert.ok(row);
    assert.equal(row.valuesJson.same_page_formula, "done");

    const deniedWrite = await request(
      `/pages/${ids.targetPage}/records/${ids.one}/values`,
      { valuesJson: { formula_ref: "changed" } },
      "PUT",
    );
    assert.equal(deniedWrite.status, 403);
    assert.equal(await pageValue(ids.sourcePage, ids.one), undefined);
    await reset([ids.one]);
  });
  await t.test("acyclic sibling page projections resolve while a real cross-page cycle stays neutral", async () => {
    await reset([ids.one]);
    assert.equal(await pageValue(ids.targetPage, ids.one), undefined);
    assert.equal(await pageValue(ids.sourcePage, ids.one), undefined);

    const response = await read(`/pages/${ids.targetPage}/record-values`);
    assert.equal(response.status, 200);
    const rows = response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>;
    const row = rows.find((candidate) => candidate.recordId === ids.one);
    assert.ok(row);

    // projection_left -> source.branch -> target.middle -> source.leaf.
    // projection_right and source.leaf are sibling projection targets in the
    // same batch, not active ancestors, so neither may be classified as a cycle.
    assert.equal(row.valuesJson.projection_left, 6);
    assert.equal(row.valuesJson.projection_right, 6);
    assert.equal(row.valuesJson.projection_middle, 6);

    // cycle_result -> source.cycle_source -> target.cycle_target
    //              -> source.cycle_source is a real cycle and must fail neutral.
    assert.equal(row.valuesJson.cycle_result, null);
    assert.equal(row.valuesJson.cycle_target, null);
    assert.equal(await pageValue(ids.targetPage, ids.one), undefined);
    assert.equal(await pageValue(ids.sourcePage, ids.one), undefined);
  });
  await t.test("an exact field export feeds destination formulas without opening its source page", async () => {
    await reset([ids.one]);
    await db.insert(pageRecordValuesTable).values({
      pageId: ids.sourcePage,
      recordId: ids.one,
      valuesJson: { export_value: "exported", unrelated_value: "secret sibling" },
    });
    await db.insert(pageRecordValuesTable).values({
      pageId: ids.targetPage,
      recordId: ids.one,
      valuesJson: {},
    });
    await db.insert(pageRecordValuesTable).values({
      pageId: ids.relatedPage,
      recordId: ids.relatedRecord,
      valuesJson: { related_cost: 25 },
    });
    await db.update(rolesTable)
      .set({ permissionsJson: permissions([ids.targetPage]) })
      .where(eq(rolesTable.id, ids.role));
    const [secondaryRole] = await db.insert(rolesTable).values({
      nameJson: { en: `${runId} formula export` },
      permissionsJson: permissions([ids.targetPage]),
    }).returning({ id: rolesTable.id });
    ids.formulaExportRole = secondaryRole!.id;
    await db.insert(userRolesTable).values({
      userId: ids.user,
      roleId: ids.formulaExportRole,
    });
    const [aliasPage] = await db.insert(pagesTable).values({
      nameJson: { en: `${runId} formula alias source` },
      mirrorEntityId: ids.entity,
    }).returning({ id: pagesTable.id });
    ids.formulaAliasPage = aliasPage!.id;
    await db.insert(pageFieldsTable).values([
      {
        pageId: ids.formulaAliasPage,
        fieldKey: "export_alias",
        nameJson: { en: "Export alias" },
        fieldType: "page_ref",
        pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "export_value" },
        formulaExportRoleIds: [ids.formulaExportRole],
      },
      {
        pageId: ids.targetPage,
        fieldKey: "external_alias_formula",
        nameJson: { en: "External alias formula" },
        fieldType: "function",
        isFilterable: true,
        formulaConfigJson: { expression: `{page:${ids.formulaAliasPage}.export_alias}` },
      },
    ]);
    const sourceFieldWhere = and(
      eq(pageFieldsTable.pageId, ids.sourcePage),
      eq(pageFieldsTable.fieldKey, "export_value"),
    );
    try {
      let response = await read(`/pages/${ids.targetPage}/record-values`);
      assert.equal(response.status, 200);
      let row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_formula, null, "the export is default-deny");
      assert.equal(row.valuesJson.unrelated_formula, null);
      assert.equal(row.valuesJson.external_alias_formula, null);
      assert.equal(row.valuesJson.related_cost_formula, null);
      let deniedOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.equal(deniedOptions.status, 200);
      assert.deepEqual(deniedOptions.body.values, [], "denial must not appear as an empty option");
      let deniedEmpty = await request(
        `/entities/${ids.entity}/records/query`,
        {
          pageId: ids.targetPage,
          page: 1,
          pageSize: 10,
          pageLocalFilters: [{ field: "external_formula", operator: "is_empty" }],
        },
        "POST",
      );
      assert.equal(deniedEmpty.status, 200);
      assert.equal(deniedEmpty.body.total, 0, "denial must not match is_empty");

      await db.update(pageFieldsTable)
        .set({ formulaExportRoleIds: [ids.formulaExportRole] })
        .where(sourceFieldWhere);
      response = await read(`/pages/${ids.targetPage}/record-values`);
      assert.equal(response.status, 200);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_formula, "exported");
      assert.equal(row.valuesJson.unrelated_formula, null, "a sibling field is not transitively exported");
      assert.equal(row.valuesJson.external_chain_formula, null, "a formula source itself is not implicitly exported");
      assert.equal(row.valuesJson.external_alias_formula, "exported", "page_ref sources resolve through both exact grants");

      await db.update(pageFieldsTable)
        .set({ formulaExportRoleIds: [ids.formulaExportRole] })
        .where(and(
          eq(pageFieldsTable.pageId, ids.sourcePage),
          eq(pageFieldsTable.fieldKey, "export_chain"),
        ));
      await db.update(pageFieldsTable)
        .set({ formulaExportRoleIds: [ids.formulaExportRole] })
        .where(and(
          eq(pageFieldsTable.pageId, ids.relatedPage),
          eq(pageFieldsTable.fieldKey, "related_cost"),
        ));
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_chain_formula, "exported");
      assert.equal(row.valuesJson.related_cost_formula, 25);

      const sourceRecordDenied = permissions([ids.targetPage]);
      sourceRecordDenied.records[String(ids.relatedEntity)] = {
        view: false, create: false, update: false, delete: false,
      };
      await db.update(rolesTable)
        .set({ permissionsJson: sourceRecordDenied })
        .where(inArray(rolesTable.id, [ids.role, ids.formulaExportRole]));
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.related_cost_formula, null, "source-record view remains required");
      const deniedAggregateEmpty = await request(
        `/entities/${ids.entity}/records/query`,
        {
          pageId: ids.targetPage,
          page: 1,
          pageSize: 10,
          pageLocalFilters: [{ field: "related_cost_formula", operator: "is_empty" }],
        },
        "POST",
      );
      assert.equal(deniedAggregateEmpty.status, 200, JSON.stringify(deniedAggregateEmpty.body));
      assert.deepEqual(
        (deniedAggregateEmpty.body.data as { id: number }[]).map((candidate) => candidate.id),
        [],
        "a denied source record boundary must not become an empty aggregate",
      );

      const sourceOwn = permissions([ids.targetPage]);
      sourceOwn.records[String(ids.relatedEntity)] = {
        view: true,
        create: false,
        update: false,
        delete: false,
        scope: "own",
        scopeFieldKeys: ["owner"],
      };
      await db.update(rolesTable)
        .set({ permissionsJson: sourceOwn })
        .where(inArray(rolesTable.id, [ids.role, ids.formulaExportRole]));
      await db.update(entityRecordsTable)
        .set({ valuesJson: { name: "לקוח Договор", owner: null } })
        .where(eq(entityRecordsTable.id, ids.relatedRecord));
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.related_cost_formula, null, "source row scope remains required");
      const deniedAggregateRowEmpty = await request(
        `/entities/${ids.entity}/records/query`,
        {
          pageId: ids.targetPage,
          page: 1,
          pageSize: 10,
          pageLocalFilters: [{ field: "related_cost_formula", operator: "is_empty" }],
        },
        "POST",
      );
      assert.equal(deniedAggregateRowEmpty.status, 200, JSON.stringify(deniedAggregateRowEmpty.body));
      assert.deepEqual(
        (deniedAggregateRowEmpty.body.data as { id: number }[]).map((candidate) => candidate.id),
        [ids.two],
        "only the linked base row is denied by source-own scope",
      );
      await db.update(entityRecordsTable)
        .set({ valuesJson: { name: "לקוח Договор", owner: ids.user } })
        .where(eq(entityRecordsTable.id, ids.relatedRecord));
      await db.update(rolesTable)
        .set({ permissionsJson: permissions([ids.targetPage]) })
        .where(inArray(rolesTable.id, [ids.role, ids.formulaExportRole]));

      const setSourceMirrorOverride = async (override: RolePermissions["records"][string]) => {
        const configured = permissions([ids.targetPage]);
        configured.records[mirrorPermKey(ids.sourcePage)] = override;
        await db.update(rolesTable)
          .set({ permissionsJson: configured })
          .where(inArray(rolesTable.id, [ids.role, ids.formulaExportRole]));
      };
      await setSourceMirrorOverride({
        view: false, create: false, update: false, delete: false,
      });
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_formula, null, "source mirror view overrides entity view");

      await setSourceMirrorOverride({
        view: true,
        create: false,
        update: false,
        delete: false,
        scope: "own",
        scopeFieldKeys: ["owner"],
      });
      await db.update(entityRecordsTable)
        .set({ valuesJson: { name: "Ready", owner: null } })
        .where(eq(entityRecordsTable.id, ids.one));
      const mirrorOwnEmpty = await request(
        `/entities/${ids.entity}/records/query`,
        {
          pageId: ids.targetPage,
          page: 1,
          pageSize: 10,
          pageLocalFilters: [{ field: "external_formula", operator: "is_empty" }],
        },
        "POST",
      );
      assert.equal(mirrorOwnEmpty.status, 200);
      assert.deepEqual(
        (mirrorOwnEmpty.body.data as { id: number }[]).map((candidate) => candidate.id),
        [ids.two],
        "a source-own denial must not masquerade as an empty formula",
      );
      await db.update(entityRecordsTable)
        .set({ valuesJson: { name: "Ready", owner: ids.user }, statusId: ids.base })
        .where(eq(entityRecordsTable.id, ids.one));

      await setSourceMirrorOverride({
        view: true,
        create: false,
        update: false,
        delete: false,
        scope: "filter",
        scopeFilters: [{
          fieldKey: "export_value",
          values: ["exported"],
          pageId: ids.sourcePage,
        }],
      });
      const mirrorPageFilterOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.deepEqual(
        mirrorPageFilterOptions.body.values,
        ["exported"],
        "source mirror page-local filters apply without page membership",
      );

      await setSourceMirrorOverride({
        view: true,
        create: false,
        update: false,
        delete: false,
        scope: "filter",
        scopeFilters: [{ fieldKey: "name", values: ["never matches"] }],
      });
      deniedOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.deepEqual(deniedOptions.body.values, [], "source mirror filter scope remains authoritative");

      await setSourceMirrorOverride({
        view: true,
        create: false,
        update: false,
        delete: false,
        hiddenRowStatusIds: [ids.done],
      });
      await db.update(entityRecordsTable)
        .set({ statusId: ids.done })
        .where(eq(entityRecordsTable.id, ids.one));
      const hiddenStatusOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.deepEqual(
        hiddenStatusOptions.body.values,
        ["__empty__"],
        "a mirror-hidden source row is excluded while a legitimate null remains",
      );
      await db.update(entityRecordsTable)
        .set({ valuesJson: { name: "Ready", owner: ids.user }, statusId: ids.base })
        .where(eq(entityRecordsTable.id, ids.one));
      await db.update(rolesTable)
        .set({ permissionsJson: permissions([ids.targetPage]) })
        .where(inArray(rolesTable.id, [ids.role, ids.formulaExportRole]));

      const filterValues = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.equal(filterValues.status, 200, JSON.stringify(filterValues.body));
      assert.deepEqual(filterValues.body.values, ["__empty__", "exported"]);
      assert.ok(!(filterValues.body.values as string[]).includes("secret sibling"));

      const destinationFieldWhere = and(
        eq(pageFieldsTable.pageId, ids.targetPage),
        eq(pageFieldsTable.fieldKey, "external_formula"),
      );
      await db.update(pageFieldsTable).set({
        permissionsJson: {
          [String(ids.role)]: "hidden",
          [String(ids.formulaExportRole)]: "hidden",
        },
      }).where(destinationFieldWhere);
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal("external_formula" in row.valuesJson, false, "destination field visibility remains required");
      await db.update(pageFieldsTable).set({ permissionsJson: {} }).where(destinationFieldWhere);

      const directSourceRead = await read(`/pages/${ids.sourcePage}/record-values`);
      assert.equal(directSourceRead.status, 403, "the grant must not open direct source-page APIs");
      const directSourceFields = await read(`/pages/${ids.sourcePage}/fields`);
      assert.equal(directSourceFields.status, 403, "the grant must not open source-field metadata APIs");

      await db.delete(userRolesTable).where(and(
        eq(userRolesTable.userId, ids.user),
        eq(userRolesTable.roleId, ids.formulaExportRole),
      ));
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_formula, null, "removing the granted role revokes immediately");
      deniedOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.deepEqual(deniedOptions.body.values, []);
      await db.insert(userRolesTable).values({
        userId: ids.user,
        roleId: ids.formulaExportRole,
      });

      await db.update(pageFieldsTable)
        .set({
          permissionsJson: {
            [String(ids.role)]: "hidden",
            [String(ids.formulaExportRole)]: "hidden",
          },
        })
        .where(sourceFieldWhere);
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_formula, null, "ordinary source-field view still applies");
      const deniedChainOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_chain_formula" },
        "POST",
      );
      assert.equal(deniedChainOptions.status, 200, JSON.stringify(deniedChainOptions.body));
      assert.deepEqual(
        deniedChainOptions.body.values,
        [],
        "denial propagates through only the exact recursive formula dependency",
      );
      const deniedAliasOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_alias_formula" },
        "POST",
      );
      assert.equal(deniedAliasOptions.status, 200, JSON.stringify(deniedAliasOptions.body));
      assert.deepEqual(
        deniedAliasOptions.body.values,
        [],
        "page_ref exports preserve denied state through their exact source",
      );

      await db.update(pageFieldsTable)
        .set({ permissionsJson: {}, formulaExportRoleIds: [] })
        .where(and(
          eq(pageFieldsTable.pageId, ids.sourcePage),
          inArray(pageFieldsTable.fieldKey, ["export_value", "export_chain"]),
        ));
      await db.update(pageFieldsTable)
        .set({ permissionsJson: {}, formulaExportRoleIds: [] })
        .where(and(
          eq(pageFieldsTable.pageId, ids.relatedPage),
          eq(pageFieldsTable.fieldKey, "related_cost"),
        ));
      await db.update(pageFieldsTable)
        .set({ permissionsJson: {} })
        .where(and(
          eq(pageFieldsTable.pageId, ids.targetPage),
          eq(pageFieldsTable.fieldKey, "external_formula"),
        ));
      response = await read(`/pages/${ids.targetPage}/record-values`);
      row = (response.body as Array<{ recordId: number; valuesJson: Record<string, unknown> }>)
        .find((candidate) => candidate.recordId === ids.one);
      assert.ok(row);
      assert.equal(row.valuesJson.external_formula, null, "revocation applies on the next request");
      deniedOptions = await request(
        `/entities/${ids.entity}/records/page-filter-values`,
        { pageId: ids.targetPage, field: "external_formula" },
        "POST",
      );
      assert.deepEqual(deniedOptions.body.values, [], "revoked exports must not emit __empty__");
      deniedEmpty = await request(
        `/entities/${ids.entity}/records/query`,
        {
          pageId: ids.targetPage,
          page: 1,
          pageSize: 10,
          pageLocalFilters: [{ field: "external_formula", operator: "is_empty" }],
        },
        "POST",
      );
      assert.equal(deniedEmpty.body.total, 0);
    } finally {
      await db.update(pageFieldsTable)
        .set({ permissionsJson: {}, formulaExportRoleIds: [] })
        .where(and(
          eq(pageFieldsTable.pageId, ids.sourcePage),
          inArray(pageFieldsTable.fieldKey, ["export_value", "export_chain"]),
        ));
      await db.update(pageFieldsTable)
        .set({ permissionsJson: {}, formulaExportRoleIds: [] })
        .where(and(
          eq(pageFieldsTable.pageId, ids.relatedPage),
          eq(pageFieldsTable.fieldKey, "related_cost"),
        ));
      await db.update(pageFieldsTable)
        .set({ permissionsJson: {} })
        .where(and(
          eq(pageFieldsTable.pageId, ids.targetPage),
          eq(pageFieldsTable.fieldKey, "external_formula"),
        ));
      await db.update(rolesTable)
        .set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
        .where(eq(rolesTable.id, ids.role));
      if (ids.formulaExportRole) {
        await db.delete(userRolesTable).where(and(
          eq(userRolesTable.userId, ids.user),
          eq(userRolesTable.roleId, ids.formulaExportRole),
        ));
        await db.delete(rolesTable).where(eq(rolesTable.id, ids.formulaExportRole));
        delete ids.formulaExportRole;
      }
      await db.delete(pageFieldsTable).where(and(
        eq(pageFieldsTable.pageId, ids.targetPage),
        eq(pageFieldsTable.fieldKey, "external_alias_formula"),
      ));
      if (ids.formulaAliasPage) {
        await db.delete(pagesTable).where(eq(pagesTable.id, ids.formulaAliasPage));
        delete ids.formulaAliasPage;
      }
      await db.delete(pageRecordValuesTable).where(and(
        eq(pageRecordValuesTable.pageId, ids.relatedPage),
        eq(pageRecordValuesTable.recordId, ids.relatedRecord),
      ));
      await db.update(entityRecordsTable)
        .set({ valuesJson: { name: "לקוח Договор", owner: ids.user } })
        .where(eq(entityRecordsTable.id, ids.relatedRecord));
      await reset([ids.one]);
    }
  });
  await t.test("single and bulk writes commit page values and mapped statuses", async () => {
    let response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "done" } }, "PUT");
    assert.equal(response.status, 200);
    assert.equal((await record(ids.one)).statusId, ids.done);
    assert.equal(((await pageValue(ids.targetPage, ids.one))!.valuesJson as Record<string, unknown>).stage, "done");
    await reset();
    response = await request(`/pages/${ids.targetPage}/records/bulk-field-values`, { fieldKey: "stage", value: "done", recordIds: [ids.one, ids.two] }, "POST");
    assert.equal(response.status, 200);
    assert.deepEqual((response.body.updatedIds as number[]).sort(), [ids.one, ids.two].sort());
    assert.equal((await record(ids.one)).statusId, ids.done);
    assert.equal((await record(ids.two)).statusId, ids.done);
    assert.equal(((await pageValue(ids.targetPage, ids.one))!.valuesJson as Record<string, unknown>).stage, "done");
    assert.equal(((await pageValue(ids.targetPage, ids.two))!.valuesJson as Record<string, unknown>).stage, "done");
  });

  await t.test("page_ref writes only its authoritative source and source access denial has no side effects", async () => {
    await reset([ids.one]);
    let response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { source_stage: "done" } }, "PUT");
    assert.equal(response.status, 200);
    assert.equal(((await pageValue(ids.sourcePage, ids.one))!.valuesJson as Record<string, unknown>).stage, "done");
    assert.equal(await pageValue(ids.targetPage, ids.one), undefined);
    assert.equal((await record(ids.one)).statusId, ids.done);
    await reset([ids.one]);
    const beforeDenied = await pageRefRollbackSnapshot(ids.one);
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage]) }).where(eq(rolesTable.id, ids.role));
    response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { source_stage: "done" } }, "PUT");
    assertPageRefDenialRedacted(response);
    assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeDenied);
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) }).where(eq(rolesTable.id, ids.role));
  });

  await t.test("bulk page_ref writes use only the source page and deny atomically without source access", async () => {
    await reset();
    let response = await request(
      `/pages/${ids.targetPage}/records/bulk-field-values`,
      { fieldKey: "source_stage", value: "done", recordIds: [ids.one, ids.two] },
      "POST",
    );
    assert.equal(response.status, 200);
    for (const recordId of [ids.one, ids.two]) {
      assert.equal(((await pageValue(ids.sourcePage, recordId))!.valuesJson as Record<string, unknown>).stage, "done");
      assert.equal(await pageValue(ids.targetPage, recordId), undefined);
      assert.equal((await record(recordId)).statusId, ids.done);
    }

    await reset();
    const beforeDenied = await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]);
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage]) }).where(eq(rolesTable.id, ids.role));
    response = await request(
      `/pages/${ids.targetPage}/records/bulk-field-values`,
      { fieldKey: "source_stage", value: "done", recordIds: [ids.one, ids.two] },
      "POST",
    );
    assert.equal(response.status, 403);
    assertPageRefDenialRedacted(response);
    assert.deepEqual(
      await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]),
      beforeDenied,
    );
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) }).where(eq(rolesTable.id, ids.role));
  });

  await t.test("page_ref source field permissions deny single writes without side effects", async () => {
    for (const access of ["hidden", "view"] as const) {
      await reset([ids.one]);
      const beforeDenied = await pageRefRollbackSnapshot(ids.one);
      await db.update(pageFieldsTable).set({
        permissionsJson: { [String(ids.role)]: access },
      }).where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      try {
        const response = await request(
          `/pages/${ids.targetPage}/records/${ids.one}/values`,
          { valuesJson: { source_stage: "done" } },
          "PUT",
        );
        assert.equal(response.status, 403, `${access} source field must deny page_ref writes`);
        assertPageRefDenialRedacted(response);
        assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeDenied);
      } finally {
        await db.update(pageFieldsTable).set({ permissionsJson: {} })
          .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      }
    }
  });

  await t.test("page_ref source field permissions deny bulk writes atomically without side effects", async () => {
    for (const access of ["hidden", "view"] as const) {
      await reset();
      const beforeDenied = await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]);
      await db.update(pageFieldsTable).set({
        permissionsJson: { [String(ids.role)]: access },
      }).where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      try {
        const response = await request(
          `/pages/${ids.targetPage}/records/bulk-field-values`,
          { fieldKey: "source_stage", value: "done", recordIds: [ids.one, ids.two] },
          "POST",
        );
        assert.equal(response.status, 403, `${access} source field must deny bulk page_ref writes`);
        assertPageRefDenialRedacted(response);
        assert.deepEqual(
          await Promise.all([pageRefRollbackSnapshot(ids.one), pageRefRollbackSnapshot(ids.two)]),
          beforeDenied,
        );
      } finally {
        await db.update(pageFieldsTable).set({ permissionsJson: {} })
          .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
      }
    }
  });

  await t.test("page_ref target alias permissions deny single and bulk writes without leaking the source", async () => {
    for (const access of ["hidden", "view"] as const) {
      for (const mode of ["single", "bulk"] as const) {
        await reset();
        const recordIds = mode === "single" ? [ids.one] : [ids.one, ids.two];
        const beforeDenied = await Promise.all(recordIds.map(pageRefRollbackSnapshot));
        await db.update(pageFieldsTable).set({
          permissionsJson: { [String(ids.role)]: access },
          ...(mode === "single"
            ? { pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "stale_source_key" } }
            : {}),
        }).where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        try {
          const response = mode === "single"
            ? await request(
                `/pages/${ids.targetPage}/records/${ids.one}/values`,
                { valuesJson: { source_stage: "done" } },
                "PUT",
              )
            : await request(
                `/pages/${ids.targetPage}/records/bulk-field-values`,
                { fieldKey: "source_stage", value: "done", recordIds },
                "POST",
              );
          assertPageRefDenialRedacted(response);
          assert.deepEqual(
            await Promise.all(recordIds.map(pageRefRollbackSnapshot)),
            beforeDenied,
            `${access} target alias ${mode} denial must have no side effects`,
          );
        } finally {
          await db.update(pageFieldsTable).set({
            permissionsJson: {},
            pageRefConfigJson: { sourcePageId: ids.sourcePage, sourceFieldKey: "stage" },
          })
            .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        }
      }
    }
  });

  await t.test("page_ref no-ops require every source and target permission in single and bulk", async () => {
    const cases: Array<{
      name: string;
      expectedStatus?: number;
      apply: () => Promise<void>;
      restore: () => Promise<void>;
    }> = [
      ...(["hidden", "view"] as const).map((access) => ({
        name: `${access} target alias`,
        apply: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: { [String(ids.role)]: access } })
            .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        },
        restore: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: {} })
            .where(and(eq(pageFieldsTable.pageId, ids.targetPage), eq(pageFieldsTable.fieldKey, "source_stage")));
        },
      })),
      ...(["hidden", "view"] as const).map((access) => ({
        name: `${access} source field`,
        apply: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: { [String(ids.role)]: access } })
            .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
        },
        restore: async () => {
          await db.update(pageFieldsTable).set({ permissionsJson: {} })
            .where(and(eq(pageFieldsTable.pageId, ids.sourcePage), eq(pageFieldsTable.fieldKey, "stage")));
        },
      })),
      {
        name: "hidden source page",
        apply: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage]) })
            .where(eq(rolesTable.id, ids.role));
        },
        restore: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
            .where(eq(rolesTable.id, ids.role));
        },
      },
      {
        name: "read-only source records",
        apply: async () => {
          const denied = permissions([ids.targetPage, ids.sourcePage]);
          denied.records[mirrorPermKey(ids.sourcePage)] = {
            view: true, create: false, update: false, delete: false,
          };
          await db.update(rolesTable).set({ permissionsJson: denied }).where(eq(rolesTable.id, ids.role));
        },
        restore: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
            .where(eq(rolesTable.id, ids.role));
        },
      },
      {
        name: "hidden source status",
        expectedStatus: 404,
        apply: async () => {
          await db.update(rolesTable).set({
            permissionsJson: permissions([ids.targetPage, ids.sourcePage], [], [ids.done]),
          }).where(eq(rolesTable.id, ids.role));
        },
        restore: async () => {
          await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
            .where(eq(rolesTable.id, ids.role));
        },
      },
    ];

    for (const permissionCase of cases) {
      for (const mode of ["single", "bulk"] as const) {
        await reset();
        const recordIds = mode === "single" ? [ids.one] : [ids.one, ids.two];
        const seed = await request(
          `/pages/${ids.targetPage}/records/bulk-field-values`,
          { fieldKey: "source_stage", value: "done", recordIds },
          "POST",
        );
        assert.equal(seed.status, 200);
        const beforeDenied = await Promise.all(recordIds.map(pageRefRollbackSnapshot));
        await permissionCase.apply();
        try {
          const response = mode === "single"
            ? await request(
                `/pages/${ids.targetPage}/records/${ids.one}/values`,
                { valuesJson: { source_stage: "done" } },
                "PUT",
              )
            : await request(
                `/pages/${ids.targetPage}/records/bulk-field-values`,
                { fieldKey: "source_stage", value: "done", recordIds },
                "POST",
              );
          if (permissionCase.expectedStatus === 404) {
            assert.equal(response.status, 404);
            assert.ok(!String(response.body.error).includes("source page"));
          } else {
            assertPageRefDenialRedacted(response);
          }
          assert.deepEqual(
            await Promise.all(recordIds.map(pageRefRollbackSnapshot)),
            beforeDenied,
            `${permissionCase.name} ${mode} no-op denial must preserve the full rollback snapshot`,
          );
        } finally {
          await permissionCase.restore();
        }
      }
    }
  });

  await t.test("page_ref source own-scope denies changed and no-op single writes without side effects", async () => {
    for (const mode of ["changed", "no-op"] as const) {
      await reset([ids.one]);
      if (mode === "no-op") {
        const seed = await request(
          `/pages/${ids.targetPage}/records/${ids.one}/values`,
          { valuesJson: { source_stage: "done" } },
          "PUT",
        );
        assert.equal(seed.status, 200);
      }
      await db.update(entityRecordsTable).set({
        valuesJson: { name: "Ready", owner: 0 },
      }).where(eq(entityRecordsTable.id, ids.one));
      const sourceOwn = permissions([ids.targetPage, ids.sourcePage]);
      sourceOwn.records[mirrorPermKey(ids.sourcePage)] = {
        view: true, create: false, update: true, delete: false, scope: "own", scopeFieldKeys: ["owner"],
      };
      await db.update(rolesTable).set({ permissionsJson: sourceOwn }).where(eq(rolesTable.id, ids.role));
      const beforeDenied = await pageRefRollbackSnapshot(ids.one);
      try {
        const response = await request(
          `/pages/${ids.targetPage}/records/${ids.one}/values`,
          { valuesJson: { source_stage: "done" } },
          "PUT",
        );
        assert.equal(response.status, 404, `${mode} source-own denial must hide the record`);
        assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeDenied);
      } finally {
        await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
          .where(eq(rolesTable.id, ids.role));
      }
    }
  });

  await t.test("single page_ref rechecks source own-scope after locking the entity record", async () => {
    await reset([ids.one]);
    const sourceOwn = permissions([ids.targetPage, ids.sourcePage]);
    sourceOwn.records[mirrorPermKey(ids.sourcePage)] = {
      view: true, create: false, update: true, delete: false, scope: "own", scopeFieldKeys: ["owner"],
    };
    await db.update(rolesTable).set({ permissionsJson: sourceOwn }).where(eq(rolesTable.id, ids.role));
    let releaseLock: (() => void) | undefined;
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    let lockReadyResolve: (() => void) | undefined;
    const lockReady = new Promise<void>((resolve) => { lockReadyResolve = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: entityRecordsTable.id }).from(entityRecordsTable)
        .where(eq(entityRecordsTable.id, ids.one)).for("update");
      await tx.update(entityRecordsTable).set({ valuesJson: { name: "Ready", owner: 0 } })
        .where(eq(entityRecordsTable.id, ids.one));
      lockReadyResolve!();
      await release;
    });
    try {
      await lockReady;
      const responsePromise = request(
        `/pages/${ids.targetPage}/records/${ids.one}/values`,
        { valuesJson: { source_stage: "done" } },
        "PUT",
      );
      // The request's unlocked preflight observes the still-committed owner,
      // then waits on this lock; release on a bounded timer to avoid a hung test.
      await new Promise((resolve) => setTimeout(resolve, 75));
      releaseLock!();
      await holder;
      const beforeResponseEffects = await pageRefRollbackSnapshot(ids.one);
      const response = await responsePromise;
      assert.equal(response.status, 404);
      assert.deepEqual(await pageRefRollbackSnapshot(ids.one), beforeResponseEffects);
    } finally {
      releaseLock?.();
      await holder.catch(() => undefined);
      await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
        .where(eq(rolesTable.id, ids.role));
    }
  });

  await t.test("workflow, required-field failures roll back page/status/version/audit/event state", async () => {
    await reset([ids.one]);
    const beforeGraphFailure = await rollbackSnapshot(ids.one);
    await db.insert(entityTransitionsTable).values({ entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive, nameJson: {}, allowedRoleIds: [], requiredFieldKeys: [], actionsJson: [] });
    let response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "done" } }, "PUT");
    assert.equal(response.status, 422);
    assert.deepEqual(await rollbackSnapshot(ids.one), beforeGraphFailure);
    await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
    await db.insert(entityTransitionsTable).values({ entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done, nameJson: {}, allowedRoleIds: [], requiredFieldKeys: ["name"], actionsJson: [] });
    await db.update(entityRecordsTable).set({ valuesJson: { attachment: { kind: "server", path: `/local/${runId}.txt`, name: "old.txt" } } }).where(eq(entityRecordsTable.id, ids.one));
    const beforeRequiredFailure = await rollbackSnapshot(ids.one);
    response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "done" } }, "PUT");
    assert.equal(response.status, 400);
    assert.deepEqual(await rollbackSnapshot(ids.one), beforeRequiredFailure);
  });

  await t.test("mapped statuses bypass picker/manual/role policy but enforce graph, actions and archive effects", async () => {
    await reset([ids.one]);
    await db.update(entitiesTable).set({ statusManualEditPolicy: "disabled_all" }).where(eq(entitiesTable.id, ids.entity));
    await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage], [ids.archive]) }).where(eq(rolesTable.id, ids.role));
    await db.insert(entityTransitionsTable).values({ entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive, nameJson: {}, allowedRoleIds: [999999], requiredFieldKeys: ["name"], actionsJson: [{ type: "set_field", fieldKey: "attachment", value: null }] });
    const response = await request(`/pages/${ids.targetPage}/records/${ids.one}/values`, { valuesJson: { stage: "archive" } }, "PUT");
    assert.equal(response.status, 200);
    const updated = await record(ids.one);
    assert.equal(updated.statusId, ids.archive);
    assert.ok(updated.archivedAt);
    assert.equal((updated.valuesJson as Record<string, unknown>).attachment, undefined);
    const audits = await db.select({ fieldKey: auditLogTable.fieldKey }).from(auditLogTable).where(eq(auditLogTable.recordId, ids.one));
    assert.ok(audits.some((row) => row.fieldKey === "__status__"));
    assert.ok(audits.some((row) => row.fieldKey === "__archived__"));
    const events = await db.select({ eventName: systemEventsTable.eventName, payload: systemEventsTable.payloadJson }).from(systemEventsTable).where(eq(systemEventsTable.recordId, ids.one));
    assert.ok(events.some((row) => row.eventName === "record.updated" && (row.payload as Record<string, unknown>).changedFields instanceof Array && ((row.payload as Record<string, unknown>).changedFields as string[]).includes("__archived__")));
    assert.ok(events.some((row) => row.eventName === "status.changed"));
    const [deleted] = await db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, ids.one));
    assert.equal(deleted!.filePath, `/local/${runId}.txt`);
  });

  await t.test("records PUT resolves matching mapped statuses after CAS and enforces their workflow atomically", async () => {
    try {
      await db.update(entitiesTable).set({ statusManualEditPolicy: "disabled_all" })
        .where(eq(entitiesTable.id, ids.entity));
      await db.update(rolesTable).set({
        permissionsJson: permissions([ids.targetPage, ids.sourcePage], [ids.done]),
      }).where(eq(rolesTable.id, ids.role));

      // The stale version must win before mapping can reach either manual-policy
      // or workflow validation.
      await reset([ids.one]);
      const staleVersion = (await record(ids.one)).version;
      let response = await request(
        `/records/${ids.one}`,
        { valuesJson: { workflow_note: "advance version" }, expectedVersion: staleVersion },
        "PUT",
      );
      assert.equal(response.status, 200);
      const advancedVersion = (await record(ids.one)).version;
      assert.ok(advancedVersion > staleVersion);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive,
        nameJson: {}, allowedRoleIds: [], requiredFieldKeys: [], actionsJson: [],
      });
      const beforeCasFailure = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { mapped_stage: "done" }, statusId: ids.done, expectedVersion: staleVersion },
        "PUT",
      );
      assert.equal(response.status, 409);
      assert.equal(response.body.currentVersion, advancedVersion);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeCasFailure);

      // A mapped write bypasses the hidden picker, manual-policy and transition
      // role restrictions, but still runs its matching graph transition/actions.
      await reset([ids.one]);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done,
        nameJson: {}, allowedRoleIds: [999999], requiredFieldKeys: ["name"],
        actionsJson: [{ type: "set_field", fieldKey: "attachment", value: null }],
      });
      const beforeSuccess = await record(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { mapped_stage: "done" }, statusId: ids.done, expectedVersion: beforeSuccess.version },
        "PUT",
      );
      assert.equal(response.status, 200);
      const mapped = await record(ids.one);
      assert.equal(mapped.statusId, ids.done);
      assert.equal(mapped.archivedAt, null);
      assert.equal(mapped.version, beforeSuccess.version + 1);
      assert.equal((mapped.valuesJson as Record<string, unknown>).mapped_stage, "done");
      assert.equal((mapped.valuesJson as Record<string, unknown>).attachment, undefined);
      const [audits, events, deletedFiles] = await Promise.all([
        db.select({ fieldKey: auditLogTable.fieldKey }).from(auditLogTable)
          .where(eq(auditLogTable.recordId, ids.one)),
        db.select({ eventName: systemEventsTable.eventName, payload: systemEventsTable.payloadJson })
          .from(systemEventsTable).where(eq(systemEventsTable.recordId, ids.one)),
        db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, ids.one)),
      ]);
      for (const fieldKey of ["mapped_stage", "attachment", "__status__"]) {
        assert.ok(audits.some((row) => row.fieldKey === fieldKey), `missing ${fieldKey} audit`);
      }
      assert.ok(!audits.some((row) => row.fieldKey === "__archived__"));
      assert.ok(events.some((row) =>
        row.eventName === "record.updated" &&
        ["mapped_stage", "attachment"].every((fieldKey) =>
          ((row.payload as Record<string, unknown>).changedFields as string[]).includes(fieldKey),
        ),
      ));
      assert.ok(events.some((row) => row.eventName === "status.changed"));
      assert.equal(deletedFiles.length, 1);
      assert.equal(deletedFiles[0]!.filePath, `/local/${runId}.txt`);

      // A configured graph without the mapped edge still rejects the write.
      await reset([ids.one]);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.archive,
        nameJson: {}, allowedRoleIds: [], requiredFieldKeys: [], actionsJson: [],
      });
      const beforeGraphFailure = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`, { valuesJson: { mapped_stage: "done" }, statusId: ids.done }, "PUT",
      );
      assert.equal(response.status, 422);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeGraphFailure);

      // workflow_note is optional at the entity level, so this is specifically
      // the transition's required-field check rather than normal validation.
      await reset([ids.one]);
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done,
        nameJson: {}, allowedRoleIds: [], requiredFieldKeys: ["workflow_note"], actionsJson: [],
      });
      const beforeRequiredFailure = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`, { valuesJson: { mapped_stage: "done" }, statusId: ids.done }, "PUT",
      );
      assert.equal(response.status, 422);
      assert.match(String(response.body.error), /Fields required for this transition: workflow_note/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeRequiredFailure);

      await reset([ids.one]);
      const beforeConflict = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { mapped_stage: "done" }, statusId: ids.archive },
        "PUT",
      );
      assert.equal(response.status, 422);
      assert.match(String(response.body.error), /conflicts with the explicitly selected system status/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeConflict);

      const beforeManualRejection = await rollbackSnapshot(ids.one);
      response = await request(`/records/${ids.one}`, { statusId: ids.archive }, "PUT");
      assert.equal(response.status, 403);
      assert.match(String(response.body.error), /Manual status editing is disabled/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeManualRejection);

      // Supplying valuesJson is not itself a mapped write. Without an actual
      // mapped-select change, ordinary picker and transition-role checks apply.
      await reset([ids.one]);
      await db.update(entitiesTable).set({ statusManualEditPolicy: "allowed" })
        .where(eq(entitiesTable.id, ids.entity));
      const beforeHiddenRejection = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { name: "Ready" }, statusId: ids.done },
        "PUT",
      );
      assert.equal(response.status, 403);
      assert.match(String(response.body.error), /status is not available to your role/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeHiddenRejection);

      await reset([ids.one]);
      await db.update(rolesTable).set({
        permissionsJson: permissions([ids.targetPage, ids.sourcePage]),
      }).where(eq(rolesTable.id, ids.role));
      await db.insert(entityTransitionsTable).values({
        entityId: ids.entity, fromStatusId: ids.base, toStatusId: ids.done,
        nameJson: {}, allowedRoleIds: [999999], requiredFieldKeys: [], actionsJson: [],
      });
      const beforeRoleRejection = await rollbackSnapshot(ids.one);
      response = await request(
        `/records/${ids.one}`,
        { valuesJson: { name: "Ready" }, statusId: ids.done },
        "PUT",
      );
      assert.equal(response.status, 403);
      assert.match(String(response.body.error), /role is not allowed to perform this transition/);
      assert.deepEqual(await rollbackSnapshot(ids.one), beforeRoleRejection);
    } finally {
      await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
      await db.update(entitiesTable).set({ statusManualEditPolicy: "allowed" })
        .where(eq(entitiesTable.id, ids.entity));
      await db.update(rolesTable).set({ permissionsJson: permissions([ids.targetPage, ids.sourcePage]) })
        .where(eq(rolesTable.id, ids.role));
      await reset([ids.one]);
    }
  });

  await t.test("bulk archive mapping applies actions and emits complete effects for every record", async () => {
    await reset();
    await db.delete(entityTransitionsTable).where(eq(entityTransitionsTable.entityId, ids.entity));
    await db.insert(entityTransitionsTable).values({
      entityId: ids.entity,
      fromStatusId: ids.base,
      toStatusId: ids.archive,
      nameJson: {},
      allowedRoleIds: [999999],
      requiredFieldKeys: ["name"],
      actionsJson: [{ type: "set_field", fieldKey: "attachment", value: null }],
    });
    const response = await request(
      `/pages/${ids.targetPage}/records/bulk-field-values`,
      { fieldKey: "stage", value: "archive", recordIds: [ids.one, ids.two] },
      "POST",
    );
    assert.equal(response.status, 200);
    for (const recordId of [ids.one, ids.two]) {
      const updated = await record(recordId);
      assert.equal(((await pageValue(ids.targetPage, recordId))!.valuesJson as Record<string, unknown>).stage, "archive");
      assert.equal(updated.statusId, ids.archive);
      assert.ok(updated.archivedAt);
      assert.equal((updated.valuesJson as Record<string, unknown>).attachment, undefined);
      const [audits, events, deleted] = await Promise.all([
        db.select({ fieldKey: auditLogTable.fieldKey }).from(auditLogTable).where(eq(auditLogTable.recordId, recordId)),
        db.select({ eventName: systemEventsTable.eventName, payload: systemEventsTable.payloadJson }).from(systemEventsTable).where(eq(systemEventsTable.recordId, recordId)),
        db.select().from(deletedFilesTable).where(eq(deletedFilesTable.recordId, recordId)),
      ]);
      assert.ok(audits.some((row) => row.fieldKey === "__status__"));
      assert.ok(audits.some((row) => row.fieldKey === "__archived__"));
      assert.ok(events.some((row) =>
        row.eventName === "record.updated" &&
        ((row.payload as Record<string, unknown>).changedFields as string[]).includes("__archived__"),
      ));
      assert.ok(events.some((row) => row.eventName === "status.changed"));
      assert.equal(deleted.length, 1);
      assert.equal(deleted[0]!.reason, "field_cleared");
    }
  });
});