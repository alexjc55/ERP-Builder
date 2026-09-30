import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./entity-automations.tsx", import.meta.url), "utf8");

test("automation status menus render server-filtered display tags above full names", () => {
  assert.match(source, /function StatusDropdownOption[\s\S]*?textValue=\{label\}[\s\S]*?<CompactStatus name=\{label\} displayTags=\{status\.displayTags\} ml=\{ml\}/);
  for (const list of ["sts", "statuses", "relatedStatuses", "currentStatuses", "targetStatuses"]) {
    assert.match(source, new RegExp(`${list}\\.map\\(\\(\\w+(?:: Status)?\\) => <StatusDropdownOption`));
  }
  // The trigger must not inherit the rich menu item with its tag caption.
  assert.match(source, /<SelectValue[^>]*>\{selected \? ml\(selected\.nameJson\)/);
  assert.match(source, /<SelectValue[^>]*>\{ml\(relatedStatuses\.find/);
  assert.match(source, /<SelectValue[^>]*>\{trigFrom === ANY \?/);
  assert.match(source, /<SelectValue[^>]*>\{trigTo === ANY \?/);
});