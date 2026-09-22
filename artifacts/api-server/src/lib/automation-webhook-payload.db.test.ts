import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, usersTable,
  pagesTable, pageFieldsTable, pageRecordValuesTable, relationsTable, recordLinksTable,
  automationActionSchema,
} from "@workspace/db";
import { buildAutomationWebhookPayload } from "./automation-webhook-payload";

// Explicit opt-in: this suite inserts and removes isolated fixtures, never migrates.
test("versioned webhook latest values, projections and backward compatibility", {
  skip: process.env.RUN_WEBHOOK_DB_TESTS !== "1",
}, async () => {
  const key = `webhook-test-${randomUUID()}`;
  const entityIds: number[] = [];
  const pageIds: number[] = [];
  const relationIds: number[] = [];
  let userId: number | undefined;
  try {
    const created = await db.insert(entitiesTable).values([{ entityKey: `${key}-a` }, { entityKey: `${key}-b` }]).returning();
    const [a, b] = created;
    entityIds.push(a!.id, b!.id);
    const [user] = await db.insert(usersTable).values({ email: `${key}@example.test`, firstName: "Ada", lastName: "Lovelace", roleId: 1 }).returning();
    userId = user!.id;
    const [page] = await db.insert(pagesTable).values({ nameJson: { en: "Context" }, mirrorEntityId: a!.id }).returning();
    pageIds.push(page!.id);
    const [secondPage] = await db.insert(pagesTable).values({ nameJson: { en: "Second context" }, mirrorEntityId: a!.id }).returning();
    pageIds.push(secondPage!.id);
    const [pageB] = await db.insert(pagesTable).values({ nameJson: { en: "Linked context" }, mirrorEntityId: b!.id }).returning();
    pageIds.push(pageB!.id);
    const [relation] = await db.insert(relationsTable).values({ sourceEntityId: a!.id, targetEntityId: b!.id, relationKey: key, relationType: "many_to_many" }).returning();
    relationIds.push(relation!.id);
    await db.insert(entityFieldsTable).values([
      { entityId: a!.id, fieldKey: "name", fieldType: "text", nameJson: { en: "Name" } },
      { entityId: a!.id, fieldKey: "missing", fieldType: "text" },
      { entityId: a!.id, fieldKey: "attachment", fieldType: "file" },
      { entityId: a!.id, fieldKey: "flag", fieldType: "boolean" },
      { entityId: a!.id, fieldKey: "choice", fieldType: "select", optionsJson: [{ value: "stable", labelJson: { en: "Current label", ru: "Метка" } }] },
      { entityId: a!.id, fieldKey: "person", fieldType: "user" },
      { entityId: a!.id, fieldKey: "text_result", fieldType: "function", formulaConfigJson: { expression: "{name}" } },
      { entityId: a!.id, fieldKey: "chain", fieldType: "function", formulaConfigJson: { expression: "{text_result}" } },
      { entityId: a!.id, fieldKey: "boolean_result", fieldType: "function", formulaConfigJson: { expression: "1 > 2" } },
      { entityId: a!.id, fieldKey: "cycle_a", fieldType: "function", formulaConfigJson: { expression: "{cycle_b}" } },
      { entityId: a!.id, fieldKey: "cycle_b", fieldType: "function", formulaConfigJson: { expression: "{cycle_a}" } },
      { entityId: a!.id, fieldKey: "related_user", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "person" } },
      { entityId: a!.id, fieldKey: "related_formula", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "computed" } },
      { entityId: a!.id, fieldKey: "linked_formula_result", fieldType: "function", formulaConfigJson: { expression: "{related_formula}" } },
      { entityId: a!.id, fieldKey: "nested", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "back_to_user" } },
      { entityId: a!.id, fieldKey: "cycle_link", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "cycle_link" } },
      { entityId: a!.id, fieldKey: "related_page", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "computed", relatedPageId: pageB!.id } },
      { entityId: b!.id, fieldKey: "person", fieldType: "user" },
      { entityId: b!.id, fieldKey: "back_to_user", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "person" } },
      { entityId: b!.id, fieldKey: "cycle_link", fieldType: "lookup", relationConfigJson: { relationId: relation!.id, relatedFieldKey: "cycle_link" } },
      { entityId: b!.id, fieldKey: "computed", fieldType: "function", formulaConfigJson: { expression: '"linked text"' } },
    ]);
    await db.insert(pageFieldsTable).values([
      { pageId: page!.id, fieldKey: "name", fieldType: "text" },
      { pageId: page!.id, fieldKey: "page_chain", fieldType: "function", formulaConfigJson: { expression: `{page:${page!.id}.name}` } },
      { pageId: secondPage!.id, fieldKey: "name", fieldType: "text" },
      { pageId: pageB!.id, fieldKey: "computed", fieldType: "function", formulaConfigJson: { expression: '"page text"' } },
    ]);
    const [record] = await db.insert(entityRecordsTable).values({ entityId: a!.id, valuesJson: { name: "Before", flag: false, choice: "stable", person: userId } }).returning();
    const [linked] = await db.insert(entityRecordsTable).values({ entityId: b!.id, valuesJson: { person: userId } }).returning();
    await db.insert(recordLinksTable).values({ relationId: relation!.id, relationType: "many_to_many", sourceRecordId: record!.id, targetRecordId: linked!.id });
    await db.insert(pageRecordValuesTable).values({ pageId: page!.id, recordId: record!.id, valuesJson: { name: "Page name" } });
    await db.insert(pageRecordValuesTable).values({ pageId: secondPage!.id, recordId: record!.id, valuesJson: { name: "Second page name" } });
    assert.deepEqual(await buildAutomationWebhookPayload(a!.id, record!.id, { includeRecord: false, pageId: 9999999 }), { entityId: a!.id, recordId: record!.id });
    // Simulates a preceding automation mutation; webhook must not use trigger-time context.
    await db.update(entityRecordsTable).set({ valuesJson: { name: "After", flag: false, choice: "stable", person: userId } }).where(eq(entityRecordsTable.id, record!.id));
    const payload = await buildAutomationWebhookPayload(a!.id, record!.id, { includeRecord: true, language: "en" });
    assert.ok("fields" in payload && payload.fields);
    assert.equal(payload.schemaVersion, 2);
    const field = (key: string) => payload.fields!.find((f) => f.key === key)!;
    const entity = (key: string) => field(`entity:${a!.id}.${key}`);
    assert.equal(payload.values!.name, "After");
    assert.equal(entity("chain").resolvedValue, "After");
    assert.equal(entity("boolean_result").resolvedValue, false);
    assert.equal(entity("cycle_a").resolvedValue, null);
    assert.equal(entity("missing").rawValue, null);
    assert.equal(entity("missing").resolvedValue, null);
    assert.equal(entity("missing").displayValue, "—");
    assert.equal(entity("flag").resolvedValue, false);
    assert.deepEqual(entity("person").resolvedValue, { id: userId, name: "Ada Lovelace" });
    assert.equal(entity("choice").displayValue, "Current label");
    assert.equal((entity("choice").resolvedValue as { id: string }).id, "stable");
    assert.equal(entity("related_user").displayValue, "Ada Lovelace");
    assert.equal(entity("related_formula").displayValue, "linked text");
    assert.equal(entity("linked_formula_result").resolvedValue, "linked text");
    assert.equal(entity("nested").displayValue, "Ada Lovelace");
    assert.ok(JSON.stringify(entity("cycle_link")).includes("projection_cycle_or_depth_limit"));
    assert.equal(entity("related_page").displayValue, "page text");
    assert.deepEqual(payload.values!.related_user, [String(userId)]);
    assert.equal(field(`page:${page!.id}.name`).resolvedValue, "Page name");
    assert.equal(field(`page:${page!.id}.page_chain`).resolvedValue, "Page name");
    assert.equal(field(`page:${secondPage!.id}.name`).resolvedValue, "Second page name");
    assert.equal(field(`page:${page!.id}.name`).pageId, page!.id);
    assert.equal(field(`page:${page!.id}.name`).contextPageId, page!.id);
    assert.equal(field(`page:${secondPage!.id}.name`).pageId, secondPage!.id);
    assert.equal(entity("text_result").resolvedValue, "After");
    assert.equal(entity("text_result").pageId, null);
    assert.equal(entity("text_result").contextPageId, null);
    const firstContextFormula = field(`entity-context:${a!.id}:page:${page!.id}.text_result`);
    const secondContextFormula = field(`entity-context:${a!.id}:page:${secondPage!.id}.text_result`);
    assert.equal(firstContextFormula.resolvedValue, "Page name");
    assert.equal(secondContextFormula.resolvedValue, "Second page name");
    assert.equal(firstContextFormula.pageId, null);
    assert.equal(firstContextFormula.contextPageId, page!.id);
    assert.equal(secondContextFormula.pageId, null);
    assert.equal(secondContextFormula.contextPageId, secondPage!.id);
    assert.equal(new Set(payload.fields!.map((f) => f.key)).size, payload.fields!.length);
    assert.equal(entity("name").resolvedValue, "After");
    assert.ok(!JSON.stringify(payload).includes("formulaConfigJson"));
    const legacySelectedPayload = await buildAutomationWebhookPayload(a!.id, record!.id, {
      includeRecord: true, language: "en", pageId: pageB!.id,
    });
    assert.ok("fields" in legacySelectedPayload && legacySelectedPayload.fields);
    assert.equal(legacySelectedPayload.pageId, null);
    assert.equal(legacySelectedPayload.fields.length, payload.fields.length);
    assert.deepEqual(legacySelectedPayload.fields.map((f) => f.key).sort(), payload.fields.map((f) => f.key).sort());
    assert.equal(legacySelectedPayload.fields.find((f) => f.key === `page:${secondPage!.id}.name`)?.resolvedValue, "Second page name");
    assert.equal(entity("attachment").resolvedValue, null);
    await db.update(entityRecordsTable).set({ valuesJson: { ...payload.values, attachment: { path: "/local/files/test.pdf", name: "PDF" } } }).where(eq(entityRecordsTable.id, record!.id));
    const configuredAction = automationActionSchema.parse({
      type: "webhook", url: "https://example.test/hook", includeRecord: true,
      language: "he", baseUrl: "https://configured-origin.example.test", pageId: page!.id,
    });
    assert.equal(configuredAction.type, "webhook");
    if (configuredAction.type !== "webhook") throw new Error("Invalid action");
    const configuredPayload = await buildAutomationWebhookPayload(a!.id, record!.id, configuredAction);
    assert.ok("fields" in configuredPayload && configuredPayload.fields);
    assert.equal(configuredPayload.language, "he");
    assert.equal(configuredPayload.pageId, null);
    assert.equal(configuredPayload.fields.some((f) => f.key === `page:${secondPage!.id}.name`), true);
    const file = configuredPayload.fields.find((f) => f.fieldKey === "attachment");
    assert.deepEqual(file!.resolvedValue, {
      kind: "server", name: "PDF", url: "https://configured-origin.example.test/api/storage/local/files/test.pdf",
      requiresAuthentication: true,
    });
  } finally {
    if (pageIds.length) await db.delete(pagesTable).where(inArray(pagesTable.id, pageIds));
    if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    if (userId != null) await db.delete(usersTable).where(eq(usersTable.id, userId));
    assert.equal(entityIds.length ? (await db.select({ id: entitiesTable.id }).from(entitiesTable).where(inArray(entitiesTable.id, entityIds))).length : 0, 0, "fixture entities cleaned");
    assert.equal(entityIds.length ? (await db.select({ id: entityFieldsTable.id }).from(entityFieldsTable).where(inArray(entityFieldsTable.entityId, entityIds))).length : 0, 0, "fixture entity fields cleaned");
    assert.equal(entityIds.length ? (await db.select({ id: entityRecordsTable.id }).from(entityRecordsTable).where(inArray(entityRecordsTable.entityId, entityIds))).length : 0, 0, "fixture records cleaned");
    assert.equal(pageIds.length ? (await db.select({ id: pagesTable.id }).from(pagesTable).where(inArray(pagesTable.id, pageIds))).length : 0, 0, "fixture pages cleaned");
    assert.equal(pageIds.length ? (await db.select({ id: pageFieldsTable.id }).from(pageFieldsTable).where(inArray(pageFieldsTable.pageId, pageIds))).length : 0, 0, "fixture page fields cleaned");
    assert.equal(pageIds.length ? (await db.select({ pageId: pageRecordValuesTable.pageId }).from(pageRecordValuesTable).where(inArray(pageRecordValuesTable.pageId, pageIds))).length : 0, 0, "fixture page values cleaned");
    assert.equal(userId == null ? 0 : (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId))).length, 0, "fixture user cleaned");
    assert.equal(relationIds.length ? (await db.select({ id: relationsTable.id }).from(relationsTable).where(inArray(relationsTable.id, relationIds))).length : 0, 0, "fixture relations cleaned");
    assert.equal(relationIds.length ? (await db.select({ id: recordLinksTable.id }).from(recordLinksTable).where(inArray(recordLinksTable.relationId, relationIds))).length : 0, 0, "fixture links cleaned");
    console.log("Webhook fixture cleanup verified: entities, fields, records, pages, page values, users, relations and links = 0");
    await pool.end();
  }
});