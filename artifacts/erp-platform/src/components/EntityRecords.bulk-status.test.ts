import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");

test("bulk status is a separate typed assignment, retaining page scope and per-row CAS", () => {
  const submit = source.slice(source.indexOf("const submitBulkFieldUpdate"), source.indexOf("const submitBulkFieldUpdate") + 1200);
  assert.match(submit, /bulkEditFieldToken === "system:status"/);
  assert.match(submit, /statusId: Number\(bulkEditValue\)/);
  assert.match(submit, /pageId: permPageId/);
  assert.match(submit, /expectedVersions:[\s\S]*record\.version/);
  assert.match(submit, /bulkStatusOptions\.some/);
  assert.match(source, /bulkEditableFields\.length > 0 \|\| canBulkEditStatus/);
});

test("bulk status menu honors all selected workflows and shows status tags only in the menu", () => {
  const options = source.slice(source.indexOf("const bulkStatusOptions"), source.indexOf("const startAddRow"));
  assert.match(options, /!hiddenStatusIds\.has/);
  assert.match(options, /!hiddenRowStatusIds\.has/);
  assert.match(options, /\.every\(record/);
  assert.match(options, /tr\.fromStatusId === record\.statusId/);
  assert.match(options, /tr\.fromStatusId == null/);
  assert.match(options, /userRoleIds\.includes/);
  assert.match(options, /statusManualEditable && showStatusColumn && canUpdate/);
  assert.match(source, /bulkStatusOptions\.map\(status[\s\S]*?<CompactStatus name=\{ml\(status\.nameJson\)\} displayTags=\{status\.displayTags\}/);
});