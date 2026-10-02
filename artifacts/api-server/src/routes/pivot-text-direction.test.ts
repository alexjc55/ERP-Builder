import assert from "node:assert/strict";
import test from "node:test";
import { resolvePivotTextDirections } from "./pivot-text-direction";

const entityFields = [
  { fieldKey: "name", textDirection: "rtl" as const },
  { fieldKey: "amount", textDirection: "ltr" as const },
];
const pageFields = [{ fieldKey: "name", textDirection: "ltr" as const }];

test("pivot returns only the requested source overrides, separating page and entity keys", () => {
  const result = resolvePivotTextDirections({
    rows: { source: "entity", fieldKey: "name" },
    cols: { source: "page", fieldKey: "name" },
    measure: { agg: "sum", source: "entity", fieldKey: "amount" },
  }, entityFields, pageFields);
  assert.deepEqual(result, {
    row: "rtl", column: "ltr", rowLanguageDriven: false,
    columnLanguageDriven: false, columnIsMeasure: false,
    measures: [{ measureKey: null, textDirection: "ltr" }],
  });
  assert.equal("fieldKey" in result, false);
  assert.equal(JSON.stringify(result).includes("amount"), false);
});

test("status axes ignore field overrides and heterogeneous measures retain individual directions", () => {
  const result = resolvePivotTextDirections({
    rows: { source: "status", fieldKey: "name" },
    cols: { source: "statusTag", fieldKey: "name" },
    measures: [
      { key: "entity", agg: "sum", source: "entity", fieldKey: "name" },
      { key: "page", agg: "sum", source: "page", fieldKey: "name" },
      { key: "formula", agg: "formula", source: "entity", fieldKey: "name" },
      { key: "count", agg: "count" },
    ],
  }, entityFields, pageFields);
  assert.equal(result.row, null);
  assert.equal(result.column, null);
  assert.equal(result.rowLanguageDriven, true);
  assert.equal(result.columnLanguageDriven, true);
  assert.equal(result.columnIsMeasure, true);
  assert.deepEqual(result.measures, [
    { measureKey: "entity", textDirection: "rtl" },
    { measureKey: "page", textDirection: "ltr" },
    { measureKey: "formula", textDirection: null },
    { measureKey: "count", textDirection: null },
  ]);
});

test("absent or permission-excluded metadata inherits without another lookup", () => {
  const result = resolvePivotTextDirections({
    rows: { source: "entity", fieldKey: "hidden" },
    measure: { agg: "sum", source: "page", fieldKey: "hidden" },
  }, entityFields, pageFields);
  assert.equal(result.row, null);
  assert.equal(result.columnIsMeasure, true);
  assert.deepEqual(result.measures, [{ measureKey: null, textDirection: null }]);
});

test("measure metadata keys match the compute core's trimmed and generated column keys", () => {
  const result = resolvePivotTextDirections({
    rows: { source: "entity", fieldKey: "name" },
    measures: [
      { key: " amount ", agg: "sum", source: "entity", fieldKey: "amount" },
      { agg: "count" },
    ],
  }, entityFields);
  assert.deepEqual(result.measures, [
    { measureKey: "amount", textDirection: "ltr" },
    { measureKey: "m1", textDirection: null },
  ]);
});