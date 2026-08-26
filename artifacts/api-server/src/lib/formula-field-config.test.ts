/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { CreateEntityFieldBody } from "@workspace/api-zod";
import {
  normalizeFormulaFieldConfig,
  normalizeFormulaFieldSources,
  validateFormulaFieldConfig,
} from "./formula-field-config";
import { buildQualifiedFormulaScope } from "./formula-runtime";
import { evaluateFormula } from "@workspace/formula";
import { presentRecord } from "../routes/records";

test("trims an affix and defaults its position to after", () => {
  assert.deepEqual(
    normalizeFormulaFieldConfig(
      {
        expression: "{quantity} * {price}",
        decimals: 2,
        displayAffix: "  USD  ",
      },
      "function",
    ),
    {
      expression: "{quantity} * {price}",
      decimals: 2,
      displayAffix: "USD",
      displayAffixPosition: "after",
    },
  );
});

test("preserves before and converts a blank affix to null", () => {
  assert.deepEqual(
    normalizeFormulaFieldConfig(
      { displayAffix: " $ ", displayAffixPosition: "before" },
      "number",
    ),
    { displayAffix: "$", displayAffixPosition: "before" },
  );
  assert.deepEqual(
    normalizeFormulaFieldConfig(
      { displayAffix: " \n ", displayAffixPosition: "before" },
      "number",
    ),
    { displayAffix: null, displayAffixPosition: null },
  );
  assert.deepEqual(
    normalizeFormulaFieldConfig({ displayAffixPosition: "before" }, "number"),
    { displayAffixPosition: null, displayAffix: null },
  );
});

test("keeps expression while normalizing formula decimals", () => {
  assert.deepEqual(
    normalizeFormulaFieldConfig({ expression: "{amount}", decimals: 2.6 }, "function"),
    { expression: "{amount}", decimals: 3 },
  );
});

test("strips both affix keys from unsupported field types", () => {
  assert.deepEqual(
    normalizeFormulaFieldConfig(
      {
        expression: "{amount}",
        decimals: 2,
        displayAffix: "USD",
        displayAffixPosition: "after",
      },
      "text",
    ),
    { expression: "{amount}", decimals: 2 },
  );
});

test("type-transition cleanup preserves unrelated legacy config properties", () => {
  assert.deepEqual(
    normalizeFormulaFieldConfig(
      {
        expression: "{amount}",
        decimals: 1,
        legacyOption: { enabled: true },
        displayAffix: "$",
        displayAffixPosition: "before",
      },
      "select",
    ),
    {
      expression: "{amount}",
      decimals: 1,
      legacyOption: { enabled: true },
    },
  );
});

test("API contract rejects display affixes longer than 100 characters", () => {
  const input = {
    fieldKey: "amount",
    nameJson: { en: "Amount" },
    fieldType: "number",
  } as const;

  assert.equal(
    CreateEntityFieldBody.safeParse({
      ...input,
      formulaConfigJson: { displayAffix: "x".repeat(100) },
    }).success,
    true,
  );
  assert.equal(
    CreateEntityFieldBody.safeParse({
      ...input,
      formulaConfigJson: { displayAffix: "x".repeat(101) },
    }).success,
    false,
  );
});

test("normalizes explicit page and external aggregate sources", () => {
  assert.deepEqual(
    normalizeFormulaFieldSources([
      { kind: "pageLocal", key: " page:2.total ", pageId: 2, fieldKey: " total " },
      {
        kind: "aggregate",
        key: "orders.sum",
        targetEntityId: 4,
        targetPageId: 3,
        join: { kind: "equality", on: [{ base: { scope: "entity", fieldKey: "client" }, target: { scope: "entity", fieldKey: "client_id" } }] },
        value: { scope: "page", pageId: 3, fieldKey: "amount" },
        aggregate: "sum",
      },
    ]),
    [
      { kind: "pageLocal", key: "page:2.total", pageId: 2, fieldKey: "total" },
      {
        kind: "aggregate",
        key: "orders.sum",
        targetEntityId: 4,
        targetPageId: 3,
        join: { kind: "equality", on: [{ base: { scope: "entity", fieldKey: "client" }, target: { scope: "entity", fieldKey: "client_id" } }] },
        value: { scope: "page", pageId: 3, fieldKey: "amount" },
        aggregate: "sum",
      },
    ],
  );
});

test("generated API contract carries structured formula sources", () => {
  const parsed = CreateEntityFieldBody.safeParse({
    fieldKey: "linked_total",
    fieldType: "function",
    nameJson: { ru: "Итого" },
    formulaConfigJson: {
      expression: "{orders.sum}",
      sources: [{
        kind: "aggregate",
        key: "orders.sum",
        targetEntityId: 4,
        value: { scope: "entity", fieldKey: "amount" },
        join: { kind: "relation", relationId: 2, baseSide: "source" },
        aggregate: "sum",
      }],
    },
  });
  assert.equal(parsed.success, true);
});

test("qualified current entity/page tokens and formula aliases share one scope", () => {
  const scope = buildQualifiedFormulaScope({
    entityId: 7,
    entityValues: { amount: 3 },
    entityFormulas: [{ key: "entity_double", expression: "{entity:7.amount} * 2" }],
    pageId: 9,
    pageValues: { amount: 11 },
    pageFormulas: [{ key: "page_total", expression: "{entity:7.entity_double} + {page:9.amount}" }],
  });
  assert.equal(evaluateFormula("{entity:7.amount} + {page:9.amount}", scope), 14);
  assert.equal(evaluateFormula("{page:9.page_total}", scope), 17);
});

test("resolver source tokens are never serialized by record presentation", () => {
  const record = presentRecord(
    { valuesJson: { visible: 1, "entity:2.amount": 99 }, createdAt: new Date("2024-01-01T00:00:00Z") },
    new Set(),
    [{
      fieldKey: "visible",
      fieldType: "function",
      formulaConfigJson: {
        expression: "{entity:2.amount}",
        sources: [{ kind: "pageLocal", key: "entity:2.amount", pageId: 2, fieldKey: "amount" }],
      },
    }] as never,
  );
  assert.deepEqual(record.valuesJson, { visible: 1 });
});

test("rejects malformed, duplicate, and valueless non-count aggregate sources", () => {
  const sources = [
    { kind: "pageLocal", key: "same", pageId: 1, fieldKey: "x" },
    { kind: "pageLocal", key: "same", pageId: 2, fieldKey: "y" },
    {
      kind: "aggregate",
      key: "bad",
      targetEntityId: 4,
      join: { kind: "relation", relationId: 2, baseSide: "source" },
      aggregate: "sum",
    },
  ];
  assert.deepEqual(normalizeFormulaFieldSources(sources), [
    { kind: "pageLocal", key: "same", pageId: 1, fieldKey: "x" },
  ]);
  assert.deepEqual(validateFormulaFieldConfig({ sources }), [
    "sources contains malformed or duplicate entries",
  ]);
});

test("keeps count valueless and uniqueJoin separators bounded", () => {
  const count = {
    kind: "aggregate",
    key: "children.count",
    targetEntityId: 2,
    join: { kind: "relation", relationId: 5, baseSide: "target" },
    aggregate: "count",
  };
  assert.deepEqual(normalizeFormulaFieldSources([count]), [count]);
  assert.equal(
    (normalizeFormulaFieldConfig(
      {
        expression: "  {children.count}  ",
        sources: [count],
      },
      "function",
    ) as { expression: string }).expression,
    "{children.count}",
  );
});

test("rejects source input that would require write-boundary normalization", () => {
  assert.deepEqual(
    validateFormulaFieldConfig({
      sources: [{ kind: "pageLocal", key: " page:2.total ", pageId: 2, fieldKey: " total " }],
    }),
    ["sources contains malformed or duplicate entries"],
  );
});