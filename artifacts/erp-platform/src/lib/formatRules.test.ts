import assert from "node:assert/strict";
import test from "node:test";
import type { FieldFormatRule } from "@workspace/api-client-react";
import {
  computeRowFormatting,
  resolveFormattingValue,
  ruleMatches,
  type FormatField,
} from "./formatRules.ts";

const rule = (operator: FieldFormatRule["operator"], value?: string, value2?: string): FieldFormatRule => ({
  operator,
  value,
  value2,
});

test("ruleMatches handles every displayed scalar field class", () => {
  const cases: Array<{
    name: string;
    value: unknown;
    formatRule: FieldFormatRule;
    expected: boolean;
  }> = [
    ...["text", "textarea", "email", "url", "phone", "select"].map((name) => ({
      name,
      value: "Approved order",
      formatRule: rule("contains", "approved"),
      expected: true,
    })),
    { name: "boolean", value: true, formatRule: rule("equals", "true"), expected: true },
    { name: "number", value: 42, formatRule: rule("gte", "42"), expected: true },
    { name: "percent", value: 12.5, formatRule: rule("between", "20", "10"), expected: true },
    { name: "date", value: "2026-02-01", formatRule: rule("gt", "2026-01-31"), expected: true },
    { name: "datetime", value: "2026-02-01T10:00:00Z", formatRule: rule("lte", "2026-02-01T10:00:00Z"), expected: true },
    { name: "created_at", value: "2026-02-01T10:00:00Z", formatRule: rule("between", "2026-02-02", "2026-02-01"), expected: true },
    { name: "created_at date equality", value: "2026-02-01T10:00:00Z", formatRule: rule("equals", "2026-02-01"), expected: true },
    { name: "datetime timestamp equality", value: "2026-02-01T10:00:00Z", formatRule: rule("equals", "2026-02-01T12:00:00+02:00"), expected: true },
    { name: "datetime timestamp inequality", value: "2026-02-01T10:00:00Z", formatRule: rule("notEquals", "2026-02-01T12:00:00+02:00"), expected: false },
    { name: "function numeric", value: 7, formatRule: rule("lt", "8"), expected: true },
    { name: "function text", value: "Calculated", formatRule: rule("contains", "cul"), expected: true },
    { name: "page_ref", value: "Source alias", formatRule: rule("equals", "Source alias"), expected: true },
    { name: "empty null", value: null, formatRule: rule("empty"), expected: true },
    { name: "empty string", value: "", formatRule: rule("empty"), expected: true },
    { name: "notEmpty", value: false, formatRule: rule("notEmpty"), expected: true },
    { name: "invalid numeric", value: "not-a-number", formatRule: rule("gt", "2"), expected: false },
    { name: "invalid date", value: "2026-99-99", formatRule: rule("gt", "2026-01-01"), expected: false },
    { name: "invalid date equality", value: "2026-99-99", formatRule: rule("equals", "2026-99-99"), expected: false },
    { name: "invalid range bound", value: 5, formatRule: rule("between", "x", "10"), expected: false },
  ];

  for (const { name, value, formatRule, expected } of cases) {
    assert.equal(ruleMatches(formatRule, value), expected, name);
  }
});

test("formatting value resolution follows rendered representations", () => {
  const rawValues = { user: 14, relation: "stale id", lookup: "stale lookup", page_ref: "raw value" };
  const displayedPageValues = { page_ref: "resolved source alias" };
  const entityRelatedValues = new Map([["relation", { value: "visible entity projection" }]]);
  const pageRelatedValues = new Map([["lookup", { value: 23 }]]);
  const cases = [
    { fieldKey: "user", fieldType: "user", expected: 14 },
    { fieldKey: "relation", fieldType: "relation", expected: "visible entity projection" },
    { fieldKey: "lookup", fieldType: "lookup", expected: 23 },
    { fieldKey: "page_ref", fieldType: "page_ref", expected: "resolved source alias" },
    { fieldKey: "function", fieldType: "function", expected: "computed" },
  ];

  for (const field of cases) {
    assert.equal(
      resolveFormattingValue(field, {
        rawValues,
        displayedPageValues,
        entityRelatedValues,
        pageRelatedValues,
        resolveDefault: () => "computed",
      }),
      field.expected,
      field.fieldType,
    );
  }
});

test("computeRowFormatting preserves inherited ordering, cell colors, and row precedence", () => {
  const fields: FormatField[] = [
    {
      fieldKey: "page_text",
      // Rules are evaluated in the order supplied by the field contract.
      formatRulesJson: [
        { ...rule("contains", "ok"), cellColor: "#own", textColor: "#text", rowColor: "#row-first" },
        { ...rule("contains", "ok"), cellColor: "#later-own", rowColor: "#later-row" },
        { ...rule("contains", "ok"), cellColor: "#inherited" },
      ],
    },
    {
      fieldKey: "number",
      formatRulesJson: [{ ...rule("equals", "2"), cellColor: "#number", rowColor: "#row-second" }],
    },
  ];

  assert.deepEqual(
    computeRowFormatting(fields, (key) => (key === "page_text" ? "OK" : 2)),
    {
      cellColors: { page_text: "#own", number: "#number" },
      cellTextColors: { page_text: "#text" },
      rowColor: "#row-first",
    },
  );
});