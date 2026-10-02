import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveDataDirection } from "./dataDirection.ts";

test("field overrides page, app and UI language", () => {
  assert.equal(resolveDataDirection("ltr", "rtl", "rtl", "he"), "ltr");
  assert.equal(resolveDataDirection("rtl", "ltr", "ltr", "en"), "rtl");
});

test("null and absent overrides inherit independently", () => {
  assert.equal(resolveDataDirection(null, "ltr", "rtl", "he"), "ltr");
  assert.equal(resolveDataDirection(undefined, null, "rtl", "en"), "rtl");
  assert.equal(resolveDataDirection(null, undefined, null, "he"), "rtl");
  assert.equal(resolveDataDirection(undefined, null, undefined, "ru"), "ltr");
  assert.equal(resolveDataDirection(null, null, null, "en"), "ltr");
});

const source = readFileSync(new URL("../components/EntityRecords.tsx", import.meta.url), "utf8");
test("data direction decorates contents, not sticky cells or table geometry", () => {
  assert.match(source, /<div dir=\{direction\} style=\{\{ textAlign: "start" \}\}/);
  assert.match(source, /const isRtl = lang === "he"/);
  assert.doesNotMatch(source, /<(?:td|th|table)\b[^>]*\bdir=/);
  const context = source.slice(source.indexOf("const recordRowContext ="), source.indexOf("if (!canView)", source.indexOf("const recordRowContext =")));
  assert.equal((context.match(/\bcellDirection\b/g) ?? []).length, 2, "memoized context includes direction in snapshot and dependencies");
});