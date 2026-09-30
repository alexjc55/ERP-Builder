import assert from "node:assert/strict";
import test from "node:test";
import { relatedStatusTarget } from "./automation-related-status";

test("related status resolves both directions and rejects wrong entity and ambiguous self links", () => {
  const relation = { sourceEntityId: 1, targetEntityId: 2 };
  assert.deepEqual(relatedStatusTarget(relation, 1), { entityId: 2, forward: true });
  assert.deepEqual(relatedStatusTarget(relation, 2), { entityId: 1, forward: false });
  assert.throws(() => relatedStatusTarget(relation, 3), /does not belong/);
  assert.throws(() => relatedStatusTarget(relation, 1, "reverse"), /direction/);
  const self = { sourceEntityId: 1, targetEntityId: 1 };
  assert.throws(() => relatedStatusTarget(self, 1), /requires relationDirection/);
  assert.deepEqual(relatedStatusTarget(self, 1, "reverse"), { entityId: 1, forward: false });
});