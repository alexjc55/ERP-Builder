import assert from "node:assert/strict";
import test from "node:test";
import { webhookFileAliases } from "./automation-webhook-files";

const file = (resolvedValue: unknown, extra = {}) => ({
  fieldKey: "order_file", type: "file", pageId: null, contextPageId: null, resolvedValue, ...extra,
});
const lookup = (field: unknown, extra = {}) => ({
  fieldKey: "order_file", type: "lookup", pageId: null, contextPageId: null,
  resolvedValue: [{ field }], ...extra,
});
const link = { kind: "link", url: "https://example.invalid/test.txt", name: "test.txt" };
const normalized = { ...link, requiresAuthentication: false, fileId: "" };

test("file aliases have one uniform shape for direct, linked and chained files", () => {
  for (const field of [file(link), lookup(file(link)), lookup(lookup(file(link)))]) {
    assert.deepEqual(webhookFileAliases([field]), { files: { order_file: [normalized] }, pageFiles: {} });
  }
});
test("preserves multiple files, empty files and protected-file authentication", () => {
  const protectedFile = { kind: "server", name: "PDF", url: "https://erp.example/api/storage/local/a.pdf", requiresAuthentication: true };
  const result = webhookFileAliases([file([link, protectedFile])]);
  assert.deepEqual(result.files.order_file, [normalized, { ...protectedFile, fileId: "" }]);
  assert.deepEqual(webhookFileAliases([lookup(file(null))]).files.order_file, []);
});
test("page fields cannot overwrite entity fields and only approved metadata is copied", () => {
  const result = webhookFileAliases([
    file({ ...link, secret: "must-not-export" }),
    file({ kind: "gdrive", fileId: "sample", url: "https://drive.google.com/file/d/sample/view", name: "Drive" }, { pageId: 12, contextPageId: 12 }),
    { fieldKey: "text", type: "text", resolvedValue: link },
    lookup({ type: "user", resolvedValue: { name: "User" } }, { fieldKey: "user" }),
  ]);
  assert.deepEqual(result.files.order_file, [normalized]);
  assert.equal(result.pageFiles["12"]!.order_file![0]!.fileId, "sample");
  assert.equal(JSON.stringify(result).includes("must-not-export"), false);
  assert.equal("text" in result.files, false);
  assert.equal("user" in result.files, false);
});
test("projection errors are not converted into misleading file links", () => {
  assert.deepEqual(webhookFileAliases([file(link, { error: "projection_cycle_or_depth_limit" })]).files, {});
});
