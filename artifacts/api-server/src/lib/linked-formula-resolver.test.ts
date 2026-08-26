import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateLinkedValues,
  filterLinkedFormulaTargetsByScope,
  linkedFormulaResourceKey,
} from "./linked-formula-resolver";

test("linked formula numeric aggregates ignore non-numeric empty values", () => {
  assert.equal(aggregateLinkedValues("sum", ["2", null, 3, "bad"]), 5);
  assert.equal(aggregateLinkedValues("average", ["2", null, 4]), 3);
  assert.equal(aggregateLinkedValues("average", [null, ""]), null);
  assert.equal(aggregateLinkedValues("count", [null, "", 1]), 3);
});

test("uniqueJoin de-duplicates while preserving target-record order", () => {
  assert.equal(aggregateLinkedValues("uniqueJoin", ["B", "A", "B", null, "A", "C"], " | "), "B | A | C");
});

test("min and max support numeric and lexical values", () => {
  assert.equal(aggregateLinkedValues("min", ["10", "2", "30"]), "2");
  assert.equal(aggregateLinkedValues("max", ["alpha", "charlie", "bravo"]), "charlie");
});

test("permission resource keys retain page qualification", () => {
  assert.notEqual(
    linkedFormulaResourceKey({ kind: "field", entityId: 1, scope: "entity", fieldKey: "amount" }),
    linkedFormulaResourceKey({ kind: "field", entityId: 1, scope: "page", pageId: 4, fieldKey: "amount" }),
  );
});

test("target row permissions are filtered once for sources sharing a scope", async () => {
  const calls: Array<{ entityId: number; pageId?: number; recordIds: readonly number[] }> = [];
  const result = await filterLinkedFormulaTargetsByScope(
    [
      { key: "total", targetEntityId: 7, targetPageId: 11 },
      { key: "count", targetEntityId: 7, targetPageId: 11 },
      { key: "otherPage", targetEntityId: 7, targetPageId: 12 },
    ],
    [
      { id: 101, entityId: 7 },
      { id: 102, entityId: 7 },
      { id: 201, entityId: 8 },
    ],
    async (scope) => {
      calls.push(scope);
      return new Set(scope.recordIds.slice(0, 1));
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.pageId === 11).length, 1);
  assert.deepEqual(calls.find((call) => call.pageId === 11)?.recordIds, [101, 102]);
  assert.strictEqual(result.get("total"), result.get("count"));
  assert.deepEqual([...result.get("total")!], [101]);
});