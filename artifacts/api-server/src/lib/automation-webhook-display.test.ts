import assert from "node:assert/strict";
import test from "node:test";
import { buildFormulaScope } from "@workspace/formula";
import { webhookDisplay, webhookFile, webhookLabel } from "./automation-webhook-display";

test("webhook display keeps null, boolean and scalar types distinct", () => {
  assert.equal(webhookDisplay(null, { fieldType: "text" }, "en"), "—");
  assert.equal(webhookDisplay(false, { fieldType: "boolean" }, "en"), "No");
  assert.equal(webhookDisplay(false, { fieldType: "boolean" }, "he"), "לא");
  assert.equal(webhookDisplay(0, { fieldType: "number" }, "ru"), "0");
  assert.equal(webhookDisplay("false", { fieldType: "text" }, "en"), "false");
  assert.equal(webhookLabel({ ru: "Красный", en: "Red", he: "אדום" }, "he"), "אדום");
});

test("number precision, percent, numeric-only affixes, dates and app timezone", () => {
  const field = { fieldType: "function", formulaConfigJson: { decimals: 2, displayAffix: "USD", displayAffixPosition: "before" } };
  assert.equal(webhookDisplay(3.1415, field, "en"), "USD 3.14");
  assert.equal(webhookDisplay("ready", field, "en"), "ready");
  assert.equal(webhookDisplay(12.55, { fieldType: "percent", percentConfigJson: { decimals: 1 } }, "en"), "12.6%");
  assert.equal(webhookDisplay("2026-03-05", { fieldType: "date" }, "en"), "05.03.2026");
  assert.equal(webhookDisplay("2026-03-05T23:15:00Z", { fieldType: "datetime" }, "he", "Asia/Jerusalem"), "06.03.2026 01:15");
});

test("shared formula evaluation preserves strings booleans dates chains and cycles", () => {
  const scope = buildFormulaScope({ name: "hello", date: "2026-03-05" }, [
    { key: "text", expression: "{name}" },
    { key: "chain", expression: "{text}" },
    { key: "bool", expression: "1 > 2" },
    { key: "date_result", expression: "{date}" },
    { key: "one", expression: "{two}" },
    { key: "two", expression: "{one}" },
  ]);
  assert.equal(scope.chain, "hello");
  assert.equal(scope.bool, false);
  assert.equal(scope.date_result, "2026-03-05");
  assert.equal(scope.one, null);
});

test("files normalize links without credentials and never publicize protected local storage", () => {
  assert.deepEqual(webhookFile({ kind: "gdrive", fileId: "abc", name: "Invoice", accessToken: "do-not-export" }), {
    kind: "gdrive", fileId: "abc", name: "Invoice", url: "https://drive.google.com/file/d/abc/view",
  });
  assert.equal((webhookFile({ kind: "gdrive", fileId: "abc", name: "Invoice", webViewLink: "https://drive.google.com/custom" }) as { url: string }).url, "https://drive.google.com/custom");
  assert.deepEqual(webhookFile({ path: "/api/storage/local/files/abc", name: "PDF", secret: "do-not-export" }, "https://erp.example.test"), {
    kind: "server", name: "PDF", url: "https://erp.example.test/api/storage/local/files/abc", requiresAuthentication: true,
  });
  assert.deepEqual(webhookFile({ kind: "link", url: "https://example.test/doc", name: "Doc" }), { kind: "link", url: "https://example.test/doc", name: "Doc" });
  assert.equal((webhookFile({ path: "/local/files/abc.pdf", name: "PDF" }, "https://erp.example.test") as { url: string }).url, "https://erp.example.test/api/storage/local/files/abc.pdf");
  assert.equal((webhookFile({ path: "/objects/uploads/abc", name: "PDF" }, "https://erp.example.test") as { url: string }).url, "https://erp.example.test/api/storage/objects/uploads/abc");
  assert.equal(webhookFile(null), null);
  assert.throws(() => webhookFile({ path: "/api/file", name: "x" }), /requires webhook baseUrl/);
  assert.throws(() => webhookFile({ kind: "link", url: "javascript:alert(1)" }), /requires webhook baseUrl/);
  assert.throws(() => webhookFile({ kind: "link", url: "https://secret:password@example.test" }), /Unsafe/);
});