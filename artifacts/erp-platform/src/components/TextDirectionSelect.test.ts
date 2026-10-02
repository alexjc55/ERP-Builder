import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const select = read("./TextDirectionSelect.tsx");
const fields = [
  read("./FieldConfigDialog.tsx"),
  read("./PageFieldConfigDialog.tsx"),
];
const pages = read("../pages/admin/pages.tsx");
const settings = read("../pages/settings.tsx");

test("inherit is a nonempty select value that explicitly clears the override", () => {
  assert.match(select, /value=\{value \?\? "inherit"\}/);
  assert.match(select, /onChange\(next === "ltr" \|\| next === "rtl" \? next : null\)/);
  for (const option of ["inherit", "ltr", "rtl"]) {
    assert.match(select, new RegExp(`SelectItem value="${option}"`));
  }
});

test("both shared field editors load, reset and persist the nullable override", () => {
  for (const source of fields) {
    assert.match(source, /useState<TextDirectionOverride>\(null\)/);
    assert.match(source, /setTextDirection\(field\.textDirection \?\? null\)/);
    assert.match(source, /else \{[\s\S]*?setTextDirection\(null\)/);
    assert.match(source, /const payload = \{[\s\S]*?\n\s+textDirection,/);
    assert.match(source, /TextDirectionSelect[^>]+value=\{textDirection\} onChange=\{setTextDirection\}/);
  }
});

test("page create/edit and ERP settings persist null rather than omitting clears", () => {
  assert.match(pages, /const openCreate = \(\) => \{[\s\S]*?setTextDirection\(null\)/);
  assert.match(pages, /setTextDirection\(page\.textDirection \?\? null\)/);
  assert.match(pages, /const payload = \{[\s\S]*?\n\s+textDirection,/);
  assert.match(settings, /setTextDirection\(settings\.textDirection \?\? null\)/);
  assert.match(settings, /updateSettings\.mutateAsync\(\{[\s\S]*?\n\s+textDirection,/);
});

test("all direction labels and inheritance guidance are curated in all three languages", () => {
  const entries = JSON.parse(read("../../../../scripts/src/data/ui-translations.json")) as {
    key: string;
    ru: string;
    en: string;
    he: string;
  }[];
  const keys = [...select.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]);
  assert.equal(keys.length, 5);
  for (const key of keys) {
    const matches = entries.filter((entry) => entry.key === key);
    assert.equal(matches.length, 1, `${key} must have exactly one curated entry`);
    for (const language of ["ru", "en", "he"] as const) {
      assert.ok(matches[0][language]?.trim(), `${key} must include ${language}`);
    }
  }
});