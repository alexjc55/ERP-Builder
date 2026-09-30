import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
const statusCell = source.slice(
  source.indexOf('if (col.kind === "status")'),
  source.indexOf('const groupBodyStyle = columnBodyStyles.get(col.pinKey)'),
);

test("archived status stacks the archive indicator below the tagged status", () => {
  assert.match(statusCell, /record\.archivedAt \? "flex-col items-start gap-1" : "items-center gap-2"/);
  assert.match(statusCell, /<CompactStatus name=\{ml\(status\.nameJson\)\}[^>]*displayTags=\{status\.displayTags\}/);
  assert.match(statusCell, /record\.archivedAt && <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap/);
  assert.match(statusCell, /<Archive className="h-3 w-3 shrink-0"/);
  assert.match(statusCell, /onClick=\{inlineEditEnabled && statusManualEditable/);
  assert.match(statusCell, /withCollab\(/);
});