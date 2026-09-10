import assert from "node:assert/strict";
import test from "node:test";
import {
  directEntityFormulaResultType,
  directFormulaDisplayValue,
} from "./directFormulaProvenance.ts";

const entityFields = [
  { fieldKey: "customer", fieldType: "user" },
  { fieldKey: "amount", fieldType: "number" },
];

test("qualified and unshadowed legacy direct references retain user provenance", () => {
  for (const expression of [" { entity:7.customer } ", "{customer}"]) {
    assert.equal(
      directEntityFormulaResultType({
        formula: { fieldKey: "copy", fieldType: "function", formulaConfigJson: { expression } },
        entityId: 7,
        entityFields,
        pageFields: [],
      }),
      "user",
    );
  }
});

test("wrong scopes, expressions, and shadowed legacy aliases have no provenance", () => {
  for (const expression of [
    "{entity:8.customer}",
    "{entity:7.customer} + 1",
    "{page:3.customer}",
  ]) {
    assert.equal(
      directEntityFormulaResultType({
        formula: { fieldKey: "copy", fieldType: "function", formulaConfigJson: { expression } },
        entityId: 7,
        entityFields,
        pageFields: [],
      }),
      null,
    );
  }
  assert.equal(
    directEntityFormulaResultType({
      formula: { fieldKey: "copy", fieldType: "function", formulaConfigJson: { expression: "{customer}" } },
      entityId: 7,
      entityFields,
      pageFields: [{ fieldKey: "customer", fieldType: "number" }],
    }),
    null,
  );
});

test("display resolves only proven user results and preserves other numbers", () => {
  const users = new Map([[42, "Ada"]]);
  assert.equal(directFormulaDisplayValue(42, "user", users), "Ada");
  assert.equal(directFormulaDisplayValue(99, "user", users), "#99");
  assert.equal(directFormulaDisplayValue(42, null, users), 42);
  assert.equal(directFormulaDisplayValue(42, "number", users), 42);
});