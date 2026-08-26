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

const qualifiedScope = mergeFormulaInputValues(
  {
    amount: 3,
    linked_amount: 999,
    "source:related_total": 12,
  },
  { amount: 8, page_linked_amount: "stale raw value" },
  new Map([["linked_amount", { fieldKey: "linked_amount", value: 4 }]]),
  new Map([["page_linked_amount", { fieldKey: "page_linked_amount", value: 6 }]]),
  { entityId: 17, pageId: 42 },
);
assert.equal(
  evaluateFormula(
    "{entity:17.amount} + {page:42.amount} + {entity:17.linked_amount} + {page:42.page_linked_amount} + {source:related_total}",
    qualifiedScope,
  ),
  33,
);
assert.equal(qualifiedScope.linked_amount, 4);
assert.equal(qualifiedScope["entity:17.linked_amount"], 4);
assert.equal(qualifiedScope.page_linked_amount, 6);
assert.equal(qualifiedScope["page:42.page_linked_amount"], 6);