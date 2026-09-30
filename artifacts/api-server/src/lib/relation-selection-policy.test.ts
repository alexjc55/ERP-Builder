import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSelection, selectionDirection, canShowRelationStatus } from "./relation-selection-policy";
import { CreateEntityFieldBody, UpdateFieldBody, CreatePageFieldBody, UpdatePageFieldBody } from "@workspace/api-zod";

test("relation status metadata requires explicit opt-in and both visibility boundaries", () => {
  const visible = { hiddenStatusIds: [], hiddenRowStatusIds: [] };
  assert.equal(canShowRelationStatus({}, 1, visible), false);
  assert.equal(canShowRelationStatus({ showStatus: false }, 1, visible), false);
  assert.equal(canShowRelationStatus({ showStatus: true }, null, visible), false);
  assert.equal(canShowRelationStatus({ showStatus: true }, 1, visible), true);
  assert.equal(canShowRelationStatus({ showStatus: true }, 1, { ...visible, hiddenStatusIds: [1] }), false);
  assert.equal(canShowRelationStatus({ showStatus: true }, 1, { ...visible, hiddenRowStatusIds: [1] }), false);
});

test("entity and page create/edit schemas preserve relation picker options and reject non-booleans", () => {
  for (const schema of [CreateEntityFieldBody, UpdateFieldBody, CreatePageFieldBody, UpdatePageFieldBody]) {
    const configSchema = schema.shape.relationConfigJson;
    for (const showStatus of [true, false]) {
      for (const allowCreate of [true, false]) {
        const config = { relationId: 1, relatedFieldKey: "name", selectionMode: "multiple", showStatus, allowCreate };
        assert.deepEqual(configSchema.parse(config), config);
      }
    }
    assert.deepEqual(configSchema.parse({}), {});
    assert.equal(configSchema.safeParse({ showStatus: "true" }).success, false);
    assert.equal(configSchema.safeParse({ allowCreate: 0 }).success, false);
  }
});

test("multiple selection is a deduplicated ID snapshot, not labels", () => {
  assert.deepEqual(normalizeSelection({ linkedRecordIds: [9, 2, 7] }, true), [2, 7, 9]);
  assert.deepEqual(normalizeSelection({ linkedRecordIds: [] }, true), []);
  assert.deepEqual(normalizeSelection({ linkedRecordId: 9 }, false), [9]);
  assert.throws(() => normalizeSelection({ linkedRecordIds: [1, 1] }, true), /Duplicate/);
  assert.throws(() => normalizeSelection({ linkedRecordId: 1, linkedRecordIds: [2] }, true), /not both/);
  assert.throws(() => normalizeSelection({ linkedRecordIds: [1, 2] }, false), /one selection/);
  assert.throws(() => normalizeSelection({ linkedRecordIds: [-1] }, true), /Invalid/);
  assert.equal(normalizeSelection({ linkedRecordIds: Array.from({ length: 123 }, (_, i) => i + 1) }, true).length, 123);
});

test("multiple fields cannot reuse a many-to-one source relation", () => {
  const relation = { sourceEntityId: 1, targetEntityId: 2, relationType: "many_to_one" as const };
  assert.equal(selectionDirection(relation, 1), "source");
  assert.equal(selectionDirection(relation, 1, { selectionMode: "multiple" }), null);
  assert.equal(selectionDirection(relation, 2, { selectionMode: "multiple" }), "target");
  assert.equal(selectionDirection({ ...relation, relationType: "many_to_many" }, 1, { selectionMode: "multiple" }), "source");
  assert.equal(selectionDirection({ ...relation, relationType: "many_to_many" }, 1), null);
});