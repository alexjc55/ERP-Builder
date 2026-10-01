import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("direct lookup references inherit only authorized projected field types", () => {
  const lookup = {
    fieldKey: "order_project_manager",
    fieldType: "lookup",
    relationConfigJson: { relationId: 25, relatedFieldKey: "project_manager" },
  };
  const options = {
    formula: {
      fieldKey: "upravlyayuschiy_proektami",
      fieldType: "function",
      formulaConfigJson: { expression: "{entity:72.order_project_manager}" },
    },
    entityId: 72,
    entityFields: [lookup],
    pageFields: [],
  };
  const columns = [{ fieldKey: lookup.fieldKey, relatedFieldType: "user" }];
  assert.equal(directEntityFormulaResultType({
    ...options, entityRelatedColumns: columns,
  }), "user");
  assert.equal(directEntityFormulaResultType({
    ...options,
    formula: { ...options.formula, formulaConfigJson: { expression: "{order_project_manager}" } },
    entityRelatedColumns: columns,
  }), "user");
  assert.equal(directEntityFormulaResultType(options), "lookup");
  for (const metadata of [
    [],
    [{ fieldKey: lookup.fieldKey, relatedFieldType: null }],
    [{ fieldKey: "another_lookup", relatedFieldType: "user" }],
  ]) {
    assert.equal(directEntityFormulaResultType({
      ...options, entityRelatedColumns: metadata,
    }), "lookup");
  }
  assert.equal(directEntityFormulaResultType({
    ...options, entityFields: [], entityRelatedColumns: columns,
  }), null, "hidden source fields must not acquire provenance through target metadata");
  assert.equal(directEntityFormulaResultType({
    ...options,
    entityFields: [{ ...lookup, fieldType: "relation" }],
    entityRelatedColumns: columns,
  }), "relation");
  assert.equal(directEntityFormulaResultType({
    ...options,
    entityRelatedColumns: [{ fieldKey: lookup.fieldKey, relatedFieldType: "number" }],
  }), "number");
  for (const expression of [
    "{entity:74.order_project_manager}",
    "{page:1024.order_project_manager}",
    "{entity:72.order_project_manager} + 1",
  ]) {
    assert.equal(directEntityFormulaResultType({
      ...options,
      formula: { ...options.formula, formulaConfigJson: { expression } },
      entityRelatedColumns: columns,
    }), null);
  }
  assert.equal(directEntityFormulaResultType({
    ...options,
    formula: { ...options.formula, formulaConfigJson: { expression: "{order_project_manager}" } },
    pageFields: [{ fieldKey: lookup.fieldKey, fieldType: "number" }],
    entityRelatedColumns: columns,
  }), null);
});

test("derived formula caller uses the existing chain authorization gate and skips denied ids", () => {
  const source = readFileSync(new URL("../routes/records.ts", import.meta.url), "utf8");
  const start = source.indexOf("const directEntityRelatedColumns:");
  const end = source.indexOf("const directFormulaTypes =", start);
  assert.ok(start >= 0 && end > start);
  const projection = source.slice(start, end);
  assert.match(projection, /for \(const field of visibleEntityFields\)/);
  assert.match(projection, /await resolveChainValues\(/);
  assert.match(projection, /if \(projection\.access !== "hidden"\)/);
  assert.doesNotMatch(projection, /db\.select/);
  assert.match(source, /entityRelatedColumns: directEntityRelatedColumns,/);
  assert.match(source, /if \(isDeniedFormulaProjection\(pageValues\.get\(row\.id\), target\.field\.fieldKey\)\) continue;/);
});