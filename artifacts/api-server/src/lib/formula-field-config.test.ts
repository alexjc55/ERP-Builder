/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { CreateEntityFieldBody } from "@workspace/api-zod";
import { normalizeFormulaFieldConfig } from "./formula-field-config";

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