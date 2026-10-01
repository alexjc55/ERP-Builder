import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWidgetColor, widgetColorHex, WIDGET_PRESET_HEX } from "./widgetColors.ts";

test("all legacy color tokens roundtrip and retain chart palette", () => {
  for (const [token, hex] of Object.entries(WIDGET_PRESET_HEX)) {
    assert.equal(normalizeWidgetColor(token), token);
    assert.equal(widgetColorHex(token), hex);
  }
});

test("custom color normalization and safe rendering exclude CSS expressions", () => {
  assert.equal(normalizeWidgetColor(" #a3c8ef "), "#A3C8EF");
  assert.equal(widgetColorHex("#a3c8ef"), "#A3C8EF");
  for (const invalid of ["", "#12", "#GG0000", "#12345678", "red", "url(https://example.test)", "constructor", "__proto__"]) {
    assert.equal(normalizeWidgetColor(invalid), null);
    assert.equal(widgetColorHex(invalid), "#2563eb");
  }
  assert.equal(widgetColorHex(null), "#2563eb");
});