import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CreateEntityFieldBody,
  CreatePageBody,
  CreatePageFieldBody,
  UpdateFieldBody,
  UpdatePageBody,
  UpdatePageFieldBody,
  UpdateSettingsBody,
} from "@workspace/api-zod";
import {
  insertAppSettingsSchema,
  insertEntityFieldSchema,
  insertPageFieldSchema,
  insertPageSchema,
} from "@workspace/db";

const createCases = [
  ["page", CreatePageBody, { nameJson: { en: "Direction" }, icon: "file" }],
  ["entity field", CreateEntityFieldBody, { fieldKey: "direction", nameJson: {}, fieldType: "text" }],
  ["page field", CreatePageFieldBody, { fieldKey: "direction", nameJson: {}, fieldType: "text" }],
] as const;

for (const [name, schema, required] of createCases) {
  test(`${name} create accepts only nullable ltr/rtl and preserves omission`, () => {
    assert.equal("textDirection" in schema.parse(required), false);
    for (const direction of ["ltr", "rtl", null]) {
      assert.equal(schema.parse({ ...required, textDirection: direction }).textDirection, direction);
    }
    for (const invalid of ["", "auto", "RTL", "he", 0, {}, []]) {
      assert.equal(schema.safeParse({ ...required, textDirection: invalid }).success, false);
    }
  });
}

for (const [name, schema] of [
  ["app settings", UpdateSettingsBody],
  ["page", UpdatePageBody],
  ["entity field", UpdateFieldBody],
  ["page field", UpdatePageFieldBody],
] as const) {
  test(`${name} update distinguishes omitted, explicit null, and overrides`, () => {
    assert.equal("textDirection" in schema.parse({}), false);
    for (const direction of ["ltr", "rtl", null]) {
      const parsed = schema.parse({ textDirection: direction });
      assert.equal("textDirection" in parsed, true);
      assert.equal(parsed.textDirection, direction);
    }
    for (const invalid of ["", "auto", "RTL", "he", false, 7, {}]) {
      assert.equal(schema.safeParse({ textDirection: invalid }).success, false);
    }
  });
}

test("Drizzle insert validators enforce the same nullable enum at every level", () => {
  for (const [schema, required] of [
    [insertAppSettingsSchema, {}],
    [insertPageSchema, {}],
    [insertEntityFieldSchema, { entityId: 1, fieldKey: "direction" }],
    [insertPageFieldSchema, { pageId: 1, fieldKey: "direction" }],
  ] as const) {
    for (const direction of ["ltr", "rtl", null]) {
      assert.equal(schema.safeParse({ ...required, textDirection: direction }).success, true);
    }
    assert.equal(schema.safeParse({ ...required, textDirection: "auto" }).success, false);
  }
});

test("explicit route update allowlists persist null and never default omitted direction", async () => {
  for (const file of ["fields", "page-fields", "pages"]) {
    const source = await readFile(new URL(`../routes/${file}.ts`, import.meta.url), "utf8");
    assert.match(source, /if \("textDirection" in body\) updateData\.textDirection = body\.textDirection;/);
    assert.match(source, /\.\.\.parsed\.data/);
  }
  const settings = await readFile(new URL("../routes/settings.ts", import.meta.url), "utf8");
  assert.match(settings, /if \(parsed\.data\.textDirection !== undefined\) updates\.textDirection = parsed\.data\.textDirection;/);
  assert.equal((settings.match(/textDirection: row\.textDirection \?\? null/g) ?? []).length, 2);
});

test("page_ref enrichment preserves the alias override and never copies source direction", async () => {
  const source = await readFile(new URL("../routes/page-fields.ts", import.meta.url), "utf8");
  assert.match(source, /\.\.\.f,\s+pageRefConfigJson: \{\s+\.\.\.cfg,\s+resolvedFieldType: src\.fieldType/);
  assert.doesNotMatch(source, /textDirection:\s*src\.textDirection/);
});