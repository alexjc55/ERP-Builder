import assert from "node:assert/strict";
import { evaluateFormula } from "@workspace/formula";
import { mergeFormulaInputValues } from "./formulaInputValues";

// Lightweight regression coverage for relation/lookup formula input. This stays
// pure: the projections model values already returned by related-values APIs.
const entityProjection = new Map([
  ["entry_date", { fieldKey: "entry_date", value: "2026-08-10" }],
]);
const entityScope = mergeFormulaInputValues(
  { material_release_date: "2026-08-11", entry_date: 162 },
  undefined,
  entityProjection,
);
assert.equal(
  evaluateFormula("daysBetween({entry_date},{material_release_date})", entityScope),
  1,
);

const pageProjection = new Map([
  ["page_entry_date", { fieldKey: "page_entry_date", value: "2026-08-10" }],
]);
const pageScope = mergeFormulaInputValues(
  { material_release_date: "2026-08-11" },
  { page_entry_date: "stale raw value" },
  undefined,
  pageProjection,
);
assert.equal(
  evaluateFormula("daysBetween({page_entry_date},{material_release_date})", pageScope),
  1,
);