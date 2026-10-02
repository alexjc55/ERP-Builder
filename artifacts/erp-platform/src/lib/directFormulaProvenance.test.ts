import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  directEntityFormulaResultType,
  directFormulaDisplayValue,
  directFormulaPresentation,
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
  assert.equal(directFormulaDisplayValue(99, "user", users), "—");
  assert.equal(directFormulaDisplayValue(42, null, users), 42);
  assert.equal(directFormulaDisplayValue(42, "number", users), 42);
});

const managerFormula = {
  fieldKey: "upravlyayuschiy_proektami",
  fieldType: "function",
  formulaConfigJson: { expression: "{entity:72.order_project_manager}" },
};
const managerLookup = {
  fieldKey: "order_project_manager",
  fieldType: "lookup",
  relationConfigJson: { relationId: 25, relatedFieldKey: "project_manager" },
};

test("direct user-valued lookups present both row and group-common ids as user names", () => {
  const type = directEntityFormulaResultType({
    formula: managerFormula,
    entityId: 72,
    entityFields: [managerLookup],
    pageFields: [managerFormula],
    entityRelatedColumns: [{ fieldKey: managerLookup.fieldKey, relatedFieldType: "user" }],
  });
  assert.equal(type, "user");
  const userNames = new Map([[42, "Ada"]]);
  for (const raw of [42, "42"]) {
    assert.equal(directFormulaDisplayValue(raw, type, userNames), "Ada");
  }
  assert.equal(directFormulaDisplayValue(null, type, userNames), null);
  assert.equal(directFormulaDisplayValue("", type, userNames), "");
});

test("lookup provenance requires matching visible source and authorized projected metadata", () => {
  const options = {
    formula: managerFormula,
    entityId: 72,
    entityFields: [managerLookup],
    pageFields: [],
  };
  assert.equal(directEntityFormulaResultType(options), "lookup");
  for (const columns of [
    [],
    [{ fieldKey: managerLookup.fieldKey, relatedFieldType: null }],
    [{ fieldKey: "another_lookup", relatedFieldType: "user" }],
  ]) {
    assert.equal(directEntityFormulaResultType({ ...options, entityRelatedColumns: columns }), "lookup");
  }
  const columns = [{ fieldKey: managerLookup.fieldKey, relatedFieldType: "user" }];
  assert.equal(directEntityFormulaResultType({
    ...options, entityFields: [], entityRelatedColumns: columns,
  }), null);
  assert.equal(directEntityFormulaResultType({
    ...options,
    entityFields: [{ ...managerLookup, fieldType: "relation" }],
    entityRelatedColumns: columns,
  }), "relation", "relations yield linked record ids, not their user-valued labels");
  assert.equal(directEntityFormulaResultType({
    ...options,
    entityRelatedColumns: [{ fieldKey: managerLookup.fieldKey, relatedFieldType: "number" }],
  }), "number");
  for (const expression of [
    "{entity:74.order_project_manager}",
    "{entity:72.order_project_manager} + 1",
    "{page:1024.order_project_manager}",
  ]) {
    assert.equal(directEntityFormulaResultType({
      ...options,
      formula: { ...managerFormula, formulaConfigJson: { expression } },
      entityRelatedColumns: columns,
    }), null);
  }
  assert.equal(directEntityFormulaResultType({
    ...options,
    formula: { ...managerFormula, formulaConfigJson: { expression: "{order_project_manager}" } },
    pageFields: [{ fieldKey: managerLookup.fieldKey, fieldType: "number" }],
    entityRelatedColumns: columns,
  }), null);
});

test("table, page, and form callers reuse authorized columns, including grouped presentation", () => {
  const source = readFileSync(new URL("../components/EntityRecords.tsx", import.meta.url), "utf8");
  for (const name of ["directEntityFormulaTypes", "directPageFormulaTypes"]) {
    const start = source.indexOf(`const ${name} = useMemo`);
    const end = source.indexOf("}, [allFields, entityId, pageFields, entityRelatedColumns, entityRelatedHydrationKey, expectedEntityRelatedHydrationKey]);", start);
    assert.ok(start >= 0 && end > start);
    const block = source.slice(start, end);
    assert.match(block, /entityRelatedHydrationKey === expectedEntityRelatedHydrationKey\s*\? entityRelatedColumns : \[\]/);
    assert.doesNotMatch(block, /knownRelatedFieldTypes/);
  }
  assert.match(source, /const directFormFormulaTypes = useMemo[\s\S]*?entityRelatedColumns: relCols,/);
  assert.match(source, /const directType =[\s\S]*?directPageFormulaTypes\.get\(col\.field\.fieldKey\)[\s\S]*?if \(directType === "user"\) \{\s*renderField = \{ \.\.\.renderField, fieldType: "user" \}/);
  assert.match(source, /commonContent = renderCellValue\(renderField, renderValue, t, userNames/);
});

test("direct lookup group values withhold ids during delayed and failed authorized metadata, then retry resolves names", () => {
  const options = {
    formula: managerFormula, entityId: 72, entityFields: [managerLookup], pageFields: [],
  };
  const users = new Map([[42, "Ada"]]);
  const unresolved = directEntityFormulaResultType(options);
  for (const raw of [42, "42"]) {
    assert.deepEqual(directFormulaPresentation(raw, unresolved, users, { metadata: "pending", users: "ready" }), { state: "pending" });
    assert.deepEqual(directFormulaPresentation(raw, unresolved, users, { metadata: "unavailable", users: "ready" }), { state: "unavailable" });
    assert.deepEqual(directFormulaPresentation(raw, unresolved, users, { metadata: "ready", users: "ready" }), { state: "unavailable" }, "denied/missing projection metadata is not an id label");
    const resolved = directEntityFormulaResultType({
      ...options, entityRelatedColumns: [{ fieldKey: managerLookup.fieldKey, relatedFieldType: "user" }],
    });
    assert.deepEqual(directFormulaPresentation(raw, resolved, users, { metadata: "ready", users: "ready" }), { state: "value", value: "Ada" });
    assert.deepEqual(directFormulaPresentation(raw, unresolved, users, { metadata: "pending", users: "ready" }), { state: "pending" }, "new scope must not reuse old proven type");
  }
});

test("missing user labels show explicit state, while numeric formulas are not guessed from ids", () => {
  for (const users of ["pending", "unavailable", "ready"] as const) {
    assert.deepEqual(directFormulaPresentation(42, "user", new Map(), { metadata: "ready", users }), { state: users === "pending" ? "pending" : "unavailable" });
    for (const resultType of [null, undefined, "number"]) {
      assert.deepEqual(directFormulaPresentation(42, resultType, new Map(), { metadata: "pending", users }), { state: "value", value: 42 });
    }
  }
});