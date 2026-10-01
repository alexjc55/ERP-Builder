import assert from "node:assert/strict";
import test from "node:test";
import {
  automationTriggerSchema,
  insertEntityAutomationSchema,
  type AutomationCondition,
  type AutomationTrigger,
} from "@workspace/db/schema";
import { CreateEntityAutomationBody, UpdateAutomationBody, GetAutomationResponse } from "@workspace/api-zod";

const combined: AutomationTrigger = { type: "record_created_or_status_changed" };

test("persistence and generated create/update/response schemas accept the independent trigger", () => {
  assert.deepEqual(automationTriggerSchema.parse(combined), combined);
  // This trigger has no from/to settings, even if a client sends stale selectors.
  assert.deepEqual(automationTriggerSchema.parse({
    ...combined, fromStatusId: 1, toStatusId: 2,
  }), combined);
  const spec = {
    entityId: 101,
    triggerJson: combined,
    conditionsJson: [{ fieldKey: "__status__", operator: "eq", value: 7 }],
    conditionConjunction: "and",
    actionsJson: [],
  };
  assert.deepEqual(insertEntityAutomationSchema.parse(spec).triggerJson, combined);
  assert.deepEqual(CreateEntityAutomationBody.parse(spec).triggerJson, combined);
  assert.deepEqual(UpdateAutomationBody.parse({ triggerJson: combined }).triggerJson, combined);
  const persisted = {
    ...spec,
    id: 1,
    folderId: null,
    nameJson: { ru: "Тест" },
    isActive: true,
    conditionConjunction: "and",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  // JSON round-trip models export/import and reloading without changing the type.
  assert.deepEqual(GetAutomationResponse.parse(JSON.parse(JSON.stringify(persisted))).triggerJson, combined);
  assert.equal(automationTriggerSchema.safeParse({ type: "record_created_and_status_changed" }).success, false);
});

test("event bus dispatch preserves old triggers and evaluates common conditions for the combined trigger", async (t) => {
  // Entirely isolated in-memory fixtures: no development/user/production rows
  // are read or changed, and any accidental real database access fails closed.
  process.env.DATABASE_URL = "postgresql://127.0.0.1:1/automation-trigger-unit-test";
  process.env.SESSION_SECRET ??= "automation-trigger-unit-test-only";
  const {
    db, pool, entityAutomationsTable, entityAutomationRunsTable,
    entityRecordsTable, entityFieldsTable, appSettingsTable, systemEventsTable,
    pageFieldsTable, pageRecordValuesTable,
  } = await import("@workspace/db");
  t.mock.method(pool, "query", () => { throw new Error("Real DB access forbidden in trigger tests"); });
  t.mock.method(pool, "connect", () => { throw new Error("Real DB connection forbidden in trigger tests"); });

  let trigger: AutomationTrigger = combined;
  let conditions: AutomationCondition[] = [];
  let conjunction = "and";
  let statusId: number | null = 7;
  let runs: Record<string, unknown>[] = [];

  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === entityAutomationsTable) return [{
      id: 1, entityId: 101, triggerJson: trigger, conditionsJson: conditions,
      conditionConjunction: conjunction, actionsJson: [], isActive: true, sortOrder: 0,
    }];
    if (table === entityRecordsTable) return [{
      id: 201, entityId: 101, statusId, valuesJson: { title: "wanted", count: 3 },
    }];
    if (table === entityFieldsTable) return [
      { fieldKey: "title", fieldType: "text" },
      { fieldKey: "count", fieldType: "number" },
    ];
    if (table === appSettingsTable) return [];
    if (table === pageFieldsTable || table === pageRecordValuesTable) return [];
    throw new Error("Unexpected table read in trigger tests");
  };
  t.mock.method(db, "select", () => ({
    from(table: unknown) {
      const rows = rowsFor(table);
      return {
        where() { return this; },
        orderBy() { return this; },
        limit(limit: number) { return Promise.resolve(rows.slice(0, limit)); },
        then(resolve: (rows: Record<string, unknown>[]) => unknown, reject: (err: unknown) => unknown) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
    },
  }));
  t.mock.method(db, "insert", (table: unknown) => ({
    values(input: Record<string, unknown> | Record<string, unknown>[]) {
      if (table === entityAutomationRunsTable) {
        assert.ok(!Array.isArray(input));
        runs.push(input);
        return Promise.resolve();
      }
      assert.equal(table, systemEventsTable, "Unexpected write in trigger tests");
      return {
        returning: async () => (Array.isArray(input) ? input : [input]).map((row, id) => ({
          ...row, id: id + 1, createdAt: new Date(),
        })),
      };
    },
  }));

  const { initAutomations, stopAutomations } = await import("./automations-engine");
  const { emitEvent } = await import("./events");
  initAutomations();
  initAutomations(); // initialization must not register a second listener
  const dispatch = async (
    eventNames: string[],
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> => {
    runs = [];
    await emitEvent(eventNames.map((eventName) => ({
      eventName, entityId: 101, recordId: 201, payload,
    })));
    // scheduleDispatch uses setImmediate; the fixture DB promises finish in
    // microtasks. Two immediate turns drain dispatch without wall-clock sleeps.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    return runs;
  };

  try {
    for (const eventName of ["record.created", "status.changed"]) {
      for (const currentStatus of [7, 8, null]) {
        await t.test(`${eventName}: __status__ condition against ${currentStatus}`, async () => {
          trigger = combined;
          statusId = currentStatus;
          conditions = [{ fieldKey: "__status__", operator: "eq", value: 7 }];
          const result = await dispatch([eventName], { from: 1, to: currentStatus });
          assert.equal(result.length, 1);
          assert.equal(result[0]!.triggerName, eventName);
          assert.equal(result[0]!.status, currentStatus === 7 ? "success" : "skipped");
          if (currentStatus !== 7) assert.deepEqual(result[0]!.detailJson, { reason: "conditions not met" });
        });
      }
    }
    await t.test("all common conditions apply on both event branches (AND and OR)", async () => {
      trigger = combined;
      statusId = 7;
      conditions = [
        { fieldKey: "__status__", operator: "eq", value: 7 },
        { fieldKey: "count", operator: "gt", value: 2 },
        { fieldKey: "title", operator: "eq", value: "wanted" },
      ];
      for (const eventName of ["record.created", "status.changed"]) {
        assert.equal((await dispatch([eventName]))[0]!.status, "success");
        conditions[2]!.value = "other";
        assert.equal((await dispatch([eventName]))[0]!.status, "skipped");
        conjunction = "or";
        assert.equal((await dispatch([eventName]))[0]!.status, "success");
        conjunction = "and";
        conditions[2]!.value = "wanted";
      }
    });
    await t.test("no update, unrelated event, or double run for a status-changing update", async () => {
      trigger = combined;
      conditions = [];
      assert.deepEqual(await dispatch(["record.updated"], { changedFields: ["title", "__status__"] }), []);
      assert.deepEqual(await dispatch(["page_field.saved", "record.deleted", "user.created"]), []);
      assert.equal((await dispatch(["record.created"])).length, 1);
      const result = await dispatch(["record.updated", "status.changed"], {
        changedFields: ["title", "__status__"], from: 1, to: 7,
      });
      assert.equal(result.length, 1);
      assert.equal(result[0]!.triggerName, "status.changed");
      assert.equal(result[0]!.status, "success");
    });
    const oldTriggers: {
      trigger: AutomationTrigger; matches: string[]; payload?: Record<string, unknown>;
    }[] = [
      { trigger: { type: "record_created" }, matches: ["record.created"] },
      { trigger: { type: "record_updated" }, matches: ["record.updated"] },
      { trigger: { type: "field_changed", fieldKey: "title" }, matches: ["record.updated"], payload: { changedFields: ["title"] } },
      { trigger: { type: "field_changed", fieldKey: "other" }, matches: [], payload: { changedFields: ["title"] } },
      { trigger: { type: "status_changed" }, matches: ["status.changed"] },
      { trigger: { type: "status_changed", fromStatusId: null, toStatusId: null }, matches: ["status.changed"] },
      { trigger: { type: "status_changed", fromStatusId: 1, toStatusId: 7 }, matches: ["status.changed"], payload: { from: 1, to: 7 } },
      { trigger: { type: "status_changed", fromStatusId: 2, toStatusId: 7 }, matches: [], payload: { from: 1, to: 7 } },
      { trigger: { type: "status_changed", fromStatusId: 1, toStatusId: 8 }, matches: [], payload: { from: 1, to: 7 } },
      { trigger: { type: "date_reached", fieldKey: "due" }, matches: [] },
      { trigger: { type: "page_field_changed", pageId: 301, fieldKey: "title" }, matches: ["page_field.saved"], payload: { pageId: 301, changedPageFieldKeys: ["title"] } },
      { trigger: { type: "page_field_changed", pageId: 302, fieldKey: "title" }, matches: [], payload: { pageId: 301, changedPageFieldKeys: ["title"] } },
    ];
    for (const [index, fixture] of oldTriggers.entries()) {
      await t.test(`old trigger semantics #${index}: ${fixture.trigger.type}`, async () => {
        trigger = fixture.trigger;
        conditions = [];
        const result = await dispatch([
          "record.created", "record.updated", "status.changed", "page_field.saved",
        ], fixture.payload);
        assert.deepEqual(result.map((run) => run.triggerName), fixture.matches);
        assert.ok(result.every((run) => run.status === "success"));
      });
    }
  } finally {
    stopAutomations();
    await pool.end();
  }
});