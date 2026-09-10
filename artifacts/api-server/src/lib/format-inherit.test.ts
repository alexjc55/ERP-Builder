import assert from "node:assert/strict";
import test from "node:test";
import { resolveInheritedFormatRules, statusRulesFor, validateFormatInherit } from "./format-inherit";

test("format inheritance validates clear and complete page-field sources", () => {
  assert.equal(validateFormatInherit([]), null);
  assert.equal(validateFormatInherit([{ kind: "pageField", pageId: 7, fieldKey: "stage" }]), null);
  assert.match(validateFormatInherit([{ kind: "pageField", pageId: 7 }]) ?? "", /поле/i);
});

test("resolver preserves source and status order with solid contrast colors", () => {
  const ownFieldRule = { operator: "equals" as const, value: "field", cellColor: "#111111" };
  const pageFieldRule = { operator: "equals" as const, value: "page", cellColor: "#222222" };
  const resolved = resolveInheritedFormatRules(
    [
      { kind: "pageField", pageId: 9, fieldKey: "stage" },
      { kind: "status", entityId: 2 },
      { kind: "field", entityId: 3, fieldKey: "state" },
    ],
    [{ entityId: 3, fieldKey: "state", formatRulesJson: [ownFieldRule] }],
    [
      { entityId: 2, nameJson: { ru: "Позже" }, color: "#ffffff", sortOrder: 2 },
      { entityId: 2, nameJson: { ru: "Раньше", en: "Earlier" }, color: "#000000", sortOrder: 1 },
    ],
    [{ pageId: 9, fieldKey: "stage", formatRulesJson: [pageFieldRule] }],
  );

  assert.deepEqual(resolved.map((rule) => rule.value), ["page", "Раньше", "Earlier", "Позже", "field"]);
  assert.deepEqual(resolved.slice(1, 4).map((rule) => [rule.cellColor, rule.textColor]), [
    ["#000000", "#ffffff"],
    ["#000000", "#ffffff"],
    ["#ffffff", "#111827"],
  ]);
  assert.equal(statusRulesFor({ ru: "Bad color" }, "transparent")[0].cellColor, "#6b7280");
});