import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { automationActionSchema, documentMappingSchema, documentGenerationOutputSchema } from "@workspace/db";
import { awaitIdempotentRun, canonicalDocumentRequestKey, convertToPdf, libreOfficeSandboxArgs, lockedDocumentWriteOptions } from "./document-generation";

test("document mappings reject executable or network sources", () => {
  assert.equal(documentMappingSchema.safeParse({
    scalars: { total: { source: "field", fieldKey: "total" } },
    collections: {},
  }).success, true);
  assert.equal(documentMappingSchema.safeParse({
    scalars: { total: { source: "javascript", value: "fetch('https://example.com')" } },
    collections: {},
  }).success, false);
});

test("idempotency waiter never claims a running generation", async () => {
  let reads = 0;
  const run = await awaitIdempotentRun(async () => {
    reads += 1;
    return reads < 3
      ? { status: "running", outputJson: null, error: null }
      : { status: "success", outputJson: { path: "/local/result.docx" }, error: null };
  }, { attempts: 4, delayMs: 0, sleep: async () => undefined });
  assert.equal(reads, 3);
  assert.equal(run.status, "success");
  await assert.rejects(() => awaitIdempotentRun(async () => ({ status: "running", outputJson: null, error: null }), {
    attempts: 2, delayMs: 0, sleep: async () => undefined,
  }), /still running/);
});

test("canonical idempotency separates mode and output while coalescing exact requests", () => {
  const output = { outputFormat: "docx" as const, destination: "local" as const, localFolderId: 3, targetFileFieldKey: "document", filenameTemplate: "Record", overwrite: "replace" as const };
  const base = { callerKey: "user-key", revisionId: 7, recordId: 11, output };
  assert.equal(canonicalDocumentRequestKey(base), canonicalDocumentRequestKey({ ...base, output: { ...output } }));
  assert.notEqual(canonicalDocumentRequestKey(base), canonicalDocumentRequestKey({ ...base, testOnly: true }));
  assert.notEqual(canonicalDocumentRequestKey(base), canonicalDocumentRequestKey({ ...base, output: { ...output, outputFormat: "pdf" } }));
  assert.notEqual(canonicalDocumentRequestKey(base), canonicalDocumentRequestKey({ ...base, output: { ...output, localFolderId: 4 } }));
});

test("LibreOffice conversion is network-isolated and fails closed without bwrap", async () => {
  const args = libreOfficeSandboxArgs("/tmp/job-123", "/nix/store/libreoffice/bin/libreoffice");
  assert.ok(args.includes("--unshare-all"));
  assert.ok(args.includes("--unshare-net"));
  const writableBinds = args.flatMap((arg, index) => arg === "--bind" ? [[args[index + 1], args[index + 2]]] : []);
  assert.deepEqual(writableBinds, [["/tmp/job-123", "/job"]]);
  assert.ok(args.includes("--clearenv"));
  await assert.rejects(
    () => convertToPdf(Buffer.from("not-a-docx"), { bwrapPath: "/definitely/missing/bwrap", libreOfficePath: "/nix/store/missing/libreoffice" }),
    /sandbox failed to start/i,
  );
});

test("replace lifecycle captures the value observed under the write lock", () => {
  const output = { outputFormat: "docx" as const, destination: "local" as const, localFolderId: 1, targetFileFieldKey: "file", filenameTemplate: "x", overwrite: "replace" as const };
  let displaced: unknown = { path: "stale-preflight" };
  const options = lockedDocumentWriteOptions(output, (value) => { displaced = value; });
  const locked = { kind: "server", path: "/local/actual-under-lock.docx" };
  options.onLockedPreviousValues({ file: locked });
  assert.deepEqual(displaced, locked);
  assert.equal(options.requireEmptyFieldKey, undefined);
  assert.equal(lockedDocumentWriteOptions({ ...output, overwrite: "error" }, () => undefined).requireEmptyFieldKey, "file");
});

test("revision immutability trigger permits parent FK cascade deletes", async () => {
  const migration = await readFile(new URL("../../../../lib/db/drizzle/0008_document_generation.sql", import.meta.url), "utf8");
  assert.match(migration, /BEFORE UPDATE ON "document_template_revisions"/);
  assert.doesNotMatch(migration, /BEFORE UPDATE OR DELETE ON "document_template_revisions"/);
  const repair = await readFile(new URL("../../../../lib/db/drizzle/0009_document_revision_cascade.sql", import.meta.url), "utf8");
  assert.match(repair, /DROP TRIGGER IF EXISTS/);
  assert.match(repair, /BEFORE UPDATE ON "document_template_revisions"/);
});

test("generation-run foreign keys cascade for fresh and repaired databases", async () => {
  const fresh = await readFile(new URL("../../../../lib/db/drizzle/0008_document_generation.sql", import.meta.url), "utf8");
  const repair = await readFile(new URL("../../../../lib/db/drizzle/0010_document_generation_run_cascades.sql", import.meta.url), "utf8");
  for (const sql of [fresh, repair]) {
    assert.match(sql, /document_generation_runs_revision_id_document_template_revisions_id_fk" FOREIGN KEY \("revision_id"\)[\s\S]*?ON DELETE cascade/);
    assert.match(sql, /document_generation_runs_entity_id_entities_id_fk" FOREIGN KEY \("entity_id"\)[\s\S]*?ON DELETE cascade/);
  }
  assert.match(repair, /DROP CONSTRAINT IF EXISTS "document_generation_runs_revision_id_document_template_revisions_id_fk"/);
  assert.match(repair, /DROP CONSTRAINT IF EXISTS "document_generation_runs_entity_id_entities_id_fk"/);
});

test("document output and automation action are explicit and bounded", () => {
  const output = { outputFormat: "pdf", destination: "local", localFolderId: 3, targetFileFieldKey: "invoice", filenameTemplate: "Invoice {{number}}", overwrite: "replace" };
  assert.equal(documentGenerationOutputSchema.safeParse(output).success, true);
  assert.equal(automationActionSchema.safeParse({ type: "generate_document", revisionId: 4, output }).success, true);
  assert.equal(automationActionSchema.safeParse({ type: "generate_document", revisionId: -1, output }).success, false);
  assert.equal(documentGenerationOutputSchema.safeParse({ ...output, destination: "gdrive" }).success, false);
  assert.equal(documentGenerationOutputSchema.safeParse({ ...output, overwrite: "append" }).success, false);
});
