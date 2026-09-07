import assert from "node:assert/strict";
import test from "node:test";
import {
  mappedStatusForChangedValues,
  normalizeOptions,
  sanitizeOptionsInput,
} from "./selectOptions";

const field = (fieldKey: string, optionsJson: unknown) => ({
  fieldKey,
  fieldType: "select",
  optionsJson,
});

test("option normalization and sanitization preserve a valid status binding", () => {
  const raw = [{ value: "done", labelJson: { ru: "Выполнено" }, statusId: 17 }];
  for (const result of [normalizeOptions(raw), sanitizeOptionsInput(raw)]) {
    assert.equal(result[0]?.value, "done");
    assert.equal(result[0]?.labelJson.ru, "Выполнено");
    assert.equal(result[0]?.statusId, 17);
  }
});

test("a changed select value resolves its mapped system status", () => {
  const result = mappedStatusForChangedValues(
    [field("installation", [
      { value: "work", labelJson: { ru: "В работе" }, statusId: 10 },
      { value: "done", labelJson: { ru: "Выполнено" }, statusId: 20 },
    ])],
    { installation: "work" },
    { installation: "done" },
  );
  assert.deepEqual(result, { statusId: 20, fieldKeys: ["installation"] });
});

test("unchanged select values do not reapply their status binding", () => {
  const result = mappedStatusForChangedValues(
    [field("installation", [
      { value: "done", labelJson: { ru: "Выполнено" }, statusId: 20 },
    ])],
    { installation: "done" },
    { installation: "done" },
  );
  assert.deepEqual(result, { fieldKeys: [] });
});

test("multiple changed fields may target the same status", () => {
  const result = mappedStatusForChangedValues(
    [
      field("installation", [{ value: "done", labelJson: {}, statusId: 20 }]),
      field("quality", [{ value: "approved", labelJson: {}, statusId: 20 }]),
    ],
    { installation: "work", quality: "pending" },
    { installation: "done", quality: "approved" },
  );
  assert.deepEqual(result, {
    statusId: 20,
    fieldKeys: ["installation", "quality"],
  });
});

test("different mapped statuses in one write are rejected", () => {
  const result = mappedStatusForChangedValues(
    [
      field("installation", [{ value: "done", labelJson: {}, statusId: 20 }]),
      field("quality", [{ value: "approved", labelJson: {}, statusId: 30 }]),
    ],
    { installation: "work", quality: "pending" },
    { installation: "done", quality: "approved" },
  );
  assert.ok("error" in result);
  assert.deepEqual(result.fieldKeys, ["installation", "quality"]);
});

test("page-local select mappings react only to the authoritative changed value", () => {
  const pageField = field("page_stage", [
    { value: "queued", labelJson: {}, statusId: 10 },
    { value: "done", labelJson: {}, statusId: 20 },
    { value: "note_only", labelJson: {} },
  ]);
  assert.deepEqual(
    mappedStatusForChangedValues([pageField], { page_stage: "queued" }, { page_stage: "done" }),
    { statusId: 20, fieldKeys: ["page_stage"] },
  );
  assert.deepEqual(
    mappedStatusForChangedValues([pageField], { page_stage: "done" }, { page_stage: "note_only" }),
    { fieldKeys: [] },
  );
  assert.deepEqual(
    mappedStatusForChangedValues([pageField], { page_stage: "done" }, {}),
    { fieldKeys: [] },
  );
});