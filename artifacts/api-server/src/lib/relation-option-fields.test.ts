import assert from "node:assert/strict";
import test from "node:test";
import { relationOptionFields } from "./relation-option-fields";

test("aggregate opt-in exposes SUM capabilities without loosening lookup projection defaults", () => {
  const fields = [
    { fieldKey: "num", fieldType: "number", nameJson: {} },
    { fieldKey: "once", fieldType: "function", nameJson: {}, formulaConfigJson: { expression: "{num}", groupResult: { enabled: true } } },
    { fieldKey: "empty", fieldType: "function", nameJson: {}, formulaConfigJson: { expression: " " } },
    { fieldKey: "text", fieldType: "text", nameJson: {} },
    { fieldKey: "", fieldType: "number", nameJson: {} },
  ];
  const normal = relationOptionFields(fields);
  assert.deepEqual(normal.map(f => f.key), ["num", "empty", "text"]);
  assert.ok(normal.every(f => !("supportsSum" in f)));
  const aggregate = relationOptionFields(fields, true);
  assert.deepEqual(aggregate.filter(f => f.supportsSum).map(f => f.key), ["num", "once"]);
  assert.ok(aggregate.every(f => !("formulaConfigJson" in f)));
  assert.deepEqual(relationOptionFields(fields, false), normal);
});