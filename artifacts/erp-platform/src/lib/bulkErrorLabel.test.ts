import assert from "node:assert/strict";
import test from "node:test";
import { bulkErrorLabel } from "./bulkErrorLabel";

test("bulk errors identify the selected visible row without exposing hidden or historical fields", () => {
  const rows = [{ id: 1480, valuesJson: { name: "Изделие А", code: 42, secret: "private", old: "legacy" } }];
  const error = { data: { recordId: 1480 } };
  const label = bulkErrorLabel(error, "Запись 1480: validation failed", rows, new Set([1480]),
    [{ fieldKey: "name", fieldType: "text" }, { fieldKey: "code", fieldType: "number" }], "Строка");
  assert.equal(label, "Строка 1 — Изделие А · 42 (#1480): validation failed");
  assert.equal(bulkErrorLabel(error, "failed", rows, new Set(), [], "Строка"), "failed");
  assert.equal(bulkErrorLabel(error, "failed", [], new Set([1480]), [], "Строка"), "failed");
});