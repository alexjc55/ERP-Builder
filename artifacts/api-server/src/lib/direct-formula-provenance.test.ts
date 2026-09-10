import assert from "node:assert/strict";
import test from "node:test";
import { directEntityFormulaResultType } from "./direct-formula-provenance";

const entityFields = [
  { fieldKey: "customer", fieldType: "user" },
  { fieldKey: "amount", fieldType: "number" },
];

test("direct entity references retain user provenance", () => {
  assert.equal(directEntityFormulaResultType({
    formula: {
      fieldKey: "customer_copy",
      fieldType: "function",
      formulaConfigJson: { expression: " { entity:7.customer } " },
    },
    entityId: 7,
    entityFields,
    pageFields: [],
  }), "user");

  assert.equal(directEntityFormulaResultType({
    formula: {
      fieldKey: "legacy_customer_copy",
      fieldType: "function",
      formulaConfigJson: { expression: "{customer}" },
    },
    entityId: 7,
    entityFields,
    pageFields: [],
  }), "user");
});

test("numeric expressions and shadowed aliases do not inherit user provenance", () => {
  assert.equal(directEntityFormulaResultType({
    formula: {
      fieldKey: "math",
      fieldType: "function",
      formulaConfigJson: { expression: "{entity:7.customer} + 1" },
    },
    entityId: 7,
    entityFields,
    pageFields: [],
  }), null);

  assert.equal(directEntityFormulaResultType({
    formula: {
      fieldKey: "shadowed",
      fieldType: "function",
      formulaConfigJson: { expression: "{customer}" },
    },
    entityId: 7,
    entityFields,
    pageFields: [{ fieldKey: "customer", fieldType: "number" }],
  }), null);
});