import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseRecordPageFormulaContext,
  materializeVisibleEntityFormulas,
  materializeVisiblePageFormulas,
} from "./formula-runtime";

test("page formula context requires page access and canonical entity ownership", () => {
  const entityAuthorized = {
    superAdmin: false,
    pageIds: [] as number[],
  };
  const entityView = { view: true, create: true, update: true, delete: false };

  // Entity record access by itself must not expose an inaccessible page.
  assert.equal(canUseRecordPageFormulaContext({
    permissions: entityAuthorized,
    entityId: 7,
    pageId: 22,
    pageEntityId: 7,
    recordPermission: entityView,
  }), false);

  // Access to a page of another entity must not make it a valid context.
  assert.equal(canUseRecordPageFormulaContext({
    permissions: { ...entityAuthorized, pageIds: [22] },
    entityId: 7,
    pageId: 22,
    pageEntityId: 8,
    recordPermission: entityView,
  }), false);

  // A page belonging to the entity, present in pageIds, with page-aware view
  // permission remains a valid formula context.
  assert.equal(canUseRecordPageFormulaContext({
    permissions: { ...entityAuthorized, pageIds: [22] },
    entityId: 7,
    pageId: 22,
    pageEntityId: 7,
    recordPermission: entityView,
  }), true);
});

test("visible linked-source formulas are materialized without returning source tokens or hidden formulas", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 11, values: { amount: 1.25 } }],
    linkedInputs: new Map([[11, { amount: 1.25, "source:linked_total": 4 }]]),
    fields: [
      { fieldKey: "amount", fieldType: "number", formulaConfigJson: {} },
      {
        fieldKey: "linked_total",
        fieldType: "function",
        formulaConfigJson: {
          expression: "{amount} * {source:linked_total}",
          decimals: 2,
          sources: [{
            kind: "aggregate",
            key: "source:linked_total",
            targetEntityId: 8,
            join: {
              kind: "equality",
              on: [{
                base: { scope: "entity", fieldKey: "order_no" },
                target: { scope: "entity", fieldKey: "order_no" },
              }],
            },
            value: { scope: "entity", fieldKey: "cost" },
            aggregate: "sum",
          }],
        },
      },
      {
        fieldKey: "qualified_chain",
        fieldType: "function",
        formulaConfigJson: { expression: "{entity:7.linked_total} + 0.5" },
      },
      {
        fieldKey: "secret_formula",
        fieldType: "function",
        formulaConfigJson: { expression: "{source:linked_total}" },
      },
    ],
    hidden: new Set(["secret_formula"]),
  });

  const result = values.get(11)!;
  assert.equal(result.linked_total, 5);
  assert.equal(result.qualified_chain, 5.5);
  assert.equal("secret_formula" in result, false);
  assert.equal("source:linked_total" in result, false);
});

test("a visible formula cannot resolve a hidden formula alias or its resolver input", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 1, values: {} }],
    linkedInputs: new Map([[1, { "source:secret": 41 }]]),
    fields: [
      {
        fieldKey: "public_formula",
        fieldType: "function",
        formulaConfigJson: { expression: "{secret_formula}" },
      },
      {
        fieldKey: "secret_formula",
        fieldType: "function",
        formulaConfigJson: {
          expression: "{source:secret}",
          sources: [{ kind: "pageLocal", key: "source:secret", pageId: 22, fieldKey: "secret" }],
        },
      },
    ],
    hidden: new Set(["secret_formula"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("secret_formula" in values, false);
  assert.equal("source:secret" in values, false);
});

test("viewer projection makes hidden stored entity fields neutral", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 1, values: { hidden_salary: 9000 } }],
    fields: [
      { fieldKey: "public_formula", fieldType: "function", formulaConfigJson: { expression: "{hidden_salary}" } },
      { fieldKey: "hidden_salary", fieldType: "number", formulaConfigJson: {} },
    ],
    hidden: new Set(["hidden_salary"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("hidden_salary" in values, false);
});

test("viewer projection makes hidden stored page fields neutral", () => {
  const values = materializeVisiblePageFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 1, entityValues: {}, pageValues: { hidden_margin: 73 } }],
    entityFields: [],
    pageFields: [
      { fieldKey: "public_formula", fieldType: "function", formulaConfigJson: { expression: "{page:22.hidden_margin}" } },
      { fieldKey: "hidden_margin", fieldType: "number", formulaConfigJson: {} },
    ],
    hiddenEntity: new Set(),
    hiddenPage: new Set(["hidden_margin"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("hidden_margin" in values, false);
});

test("entity formulas cannot read hidden page values", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 1, values: {} }],
    pageValues: new Map([[1, { hidden_margin: 73 }]]),
    fields: [
      {
        fieldKey: "public_formula",
        fieldType: "function",
        formulaConfigJson: { expression: "{page:22.hidden_margin}" },
      },
    ],
    pageFields: [
      { fieldKey: "hidden_margin", fieldType: "number", formulaConfigJson: {} },
    ],
    hidden: new Set(),
    hiddenPage: new Set(["hidden_margin"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("hidden_margin" in values, false);
});

test("entity formulas materialize page-qualified values and page formula chains", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 11, values: { amount: 2 } }],
    linkedInputs: new Map([[11, { amount: 2, "source:private": 99 }]]),
    pageValues: new Map([[11, { multiplier: 3, "source:private": 99 }]]),
    fields: [
      { fieldKey: "amount", fieldType: "number", formulaConfigJson: {} },
      {
      fieldKey: "page_based",
      fieldType: "function",
      formulaConfigJson: {
        expression: "{page:22.page_total} + {amount}",
        sources: [{ kind: "pageLocal", key: "source:private", pageId: 22, fieldKey: "private" }],
      },
    }],
    pageFields: [
      { fieldKey: "multiplier", fieldType: "number", formulaConfigJson: {} },
      {
      fieldKey: "page_total",
      fieldType: "function",
      formulaConfigJson: { expression: "{page:22.multiplier} * 4" },
    }],
    hidden: new Set(),
    hiddenPage: new Set(),
  }).get(11)!;

  assert.equal(values.page_based, 14);
  assert.equal("source:private" in values, false);
});