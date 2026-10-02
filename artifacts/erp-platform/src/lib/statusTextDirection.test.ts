import { test } from "node:test";
import assert from "node:assert/strict";
import { statusTextPresentation } from "./statusTextDirection.ts";

for (const language of ["ru", "en", "he"] as const) {
  test(`status fallback follows actual translation in ${language}`, () => {
    assert.deepEqual(statusTextPresentation({ ru: "Готово" }, language), { text: "Готово", direction: "ltr" });
    assert.deepEqual(statusTextPresentation({ he: "123 ABC מוכן" }, language), { text: "123 ABC מוכן", direction: "rtl" });
    assert.deepEqual(statusTextPresentation({ en: "Done" }, language), { text: "Done", direction: "ltr" });
    const names = { ru: "Готово", en: "Done", he: "מוכן" };
    assert.deepEqual(statusTextPresentation(names, language), { text: names[language], direction: language === "he" ? "rtl" : "ltr" });
  });
}
test("empty translations fall back and identical labels retain language provenance", () => {
  assert.deepEqual(statusTextPresentation({ ru: " ", he: "מוכן" }, "ru"), { text: "מוכן", direction: "rtl" });
  assert.deepEqual(statusTextPresentation({ ru: "OK", he: "OK" }, "he"), { text: "OK", direction: "rtl" });
  assert.deepEqual(statusTextPresentation(null, "ru", "מוכן"), { text: "מוכן", direction: "rtl" });
  assert.deepEqual(statusTextPresentation({}, "he", "—"), { text: "—", direction: "ltr" });
});