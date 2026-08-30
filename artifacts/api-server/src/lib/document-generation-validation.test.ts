import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { automationActionSchema, documentMappingSchema, documentGenerationOutputSchema } from "@workspace/db";
import { awaitIdempotentRun, canonicalDocumentRequestKey, convertToPdf, fileFieldAllowsGdrive, libreOfficeSandboxArgs, lockedDocumentWriteOptions } from "./document-generation";
import { activeOrphanRecoveryClaim, ORPHAN_RECOVERY_CLAIM_LEASE_MS, orphanRecoveryClaimDisposition, orphanTerminalResult, presentGenerationOutput, storedOrphanRecoveryClaim, validDriveOrphan, valueReferencesDriveFile } from "../routes/document-generation";
import { DrivePreconditionError, getDriveFileMetadata, trashDriveFile } from "./googleDrive";

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

test("orphan projection exposes only safe recovery status and terminal details", () => {
  const raw = { file: { kind: "gdrive", fileId: "drive-file", name: "x" }, orphaned: true,
    recovery: { targetFileFieldKey: "secret-field", driveFolderId: "private-folder", overwrite: "replace" } };
  assert.deepEqual(presentGenerationOutput(raw), { destination: "gdrive", fileId: "drive-file", name: "x", orphaned: true, recoveryAvailable: true });
  assert.deepEqual(presentGenerationOutput({ ...raw, orphanResolution: { action: "delete_output", outcome: "deleted", actorUserId: 9, resolvedAt: "2025-01-01T00:00:00.000Z", driveFolderId: "nope" } }),
    { destination: "gdrive", fileId: "drive-file", name: "x", orphaned: true, orphanResolution: { action: "delete_output", outcome: "deleted", actorUserId: 9, resolvedAt: "2025-01-01T00:00:00.000Z" } });
  assert.ok(validDriveOrphan(raw));
  assert.equal(validDriveOrphan({ ...raw, file: { kind: "server" } }), undefined);
});

test("orphan terminal action is idempotent only for the same action", () => {
  const resolution = { action: "mark_resolved", outcome: "acknowledged", actorUserId: 2, resolvedAt: "2025-01-01T00:00:00.000Z" };
  assert.deepEqual(orphanTerminalResult(7, resolution, "mark_resolved"), { runId: 7, ...resolution, idempotent: true });
  assert.throws(() => orphanTerminalResult(7, resolution, "delete_output"), /different/);
  assert.throws(() => orphanTerminalResult(7, { ...resolution, action: "delete_output", outcome: "acknowledged" }, "delete_output"), /Invalid/);
});

test("Drive recovery follows the legacy server-only default for absent or empty sources", () => {
  assert.equal(fileFieldAllowsGdrive(undefined), false);
  assert.equal(fileFieldAllowsGdrive({}), false);
  assert.equal(fileFieldAllowsGdrive({ allowedSources: [] }), false);
  assert.equal(fileFieldAllowsGdrive({ allowedSources: ["gdrive"] }), true);
});

test("recovery claims are private and expire for crash-safe takeover", () => {
  const now = Date.parse("2025-01-01T00:10:00.000Z");
  const raw = {
    file: { kind: "gdrive", fileId: "drive-file" }, orphaned: true,
    recovery: { targetFileFieldKey: "file", driveFolderId: "folder", overwrite: "replace" },
    orphanRecoveryClaim: { action: "retry_writeback", actorUserId: 4, startedAt: new Date(now - 1_000).toISOString() },
  };
  assert.ok(activeOrphanRecoveryClaim(raw, now));
  assert.equal("orphanRecoveryClaim" in (presentGenerationOutput(raw) ?? {}), false);
  assert.equal(activeOrphanRecoveryClaim({
    ...raw,
    orphanRecoveryClaim: { ...raw.orphanRecoveryClaim, startedAt: new Date(now - ORPHAN_RECOVERY_CLAIM_LEASE_MS).toISOString() },
  }, now), undefined);
  const staleDelete = {
    ...raw,
    orphanRecoveryClaim: { ...raw.orphanRecoveryClaim, action: "delete_output", startedAt: new Date(now - ORPHAN_RECOVERY_CLAIM_LEASE_MS).toISOString() },
  };
  assert.equal(storedOrphanRecoveryClaim(staleDelete)?.action, "delete_output");
  assert.equal(orphanRecoveryClaimDisposition(staleDelete, "delete_output", now), "stale_same");
  assert.equal(orphanRecoveryClaimDisposition(staleDelete, "retry_writeback", now), "different");
  assert.equal(orphanRecoveryClaimDisposition(raw, "retry_writeback", now), "active_same");
  assert.equal(orphanRecoveryClaimDisposition({ ...raw, orphanRecoveryClaim: undefined }, "retry_writeback", now), "available");
  assert.equal(activeOrphanRecoveryClaim({
    ...raw,
    orphanRecoveryClaim: { ...raw.orphanRecoveryClaim, action: "delete_output" },
  }, now)?.action, "delete_output");
  assert.equal(activeOrphanRecoveryClaim({
    ...raw,
    orphanRecoveryClaim: { ...raw.orphanRecoveryClaim, action: "not_an_action" },
  }, now), undefined);
});

test("Drive orphan trash uses metadata ETag and maps a failed precondition", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  try {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ id: "f", parents: ["p"], trashed: false }), {
          status: 200, headers: { "content-type": "application/json", etag: "\"v1\"" },
        });
      }
      return new Response(null, { status: 412 });
    }) as typeof fetch;
    const metadata = await getDriveFileMetadata("token", "f");
    assert.equal(metadata.etag, "\"v1\"");
    await assert.rejects(() => trashDriveFile("token", "f", metadata.etag), DrivePreconditionError);
    assert.equal((requests[1]?.headers as Record<string, string>)["If-Match"], "\"v1\"");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Drive reference detection is exact and recognizes an attached target", () => {
  const file = { kind: "gdrive", fileId: "abc", name: "report" };
  assert.equal(valueReferencesDriveFile(file, "abc"), true);
  assert.equal(valueReferencesDriveFile({ nested: [file] }, "abc"), true);
  assert.equal(valueReferencesDriveFile({ kind: "gdrive", fileId: "abcd" }, "abc"), false);
  assert.equal(valueReferencesDriveFile({ note: "abc" }, "abc"), false);
});

test("delete recovery commits its tombstone before provider I/O and finalizes afterward", async () => {
  const source = await readFile(new URL("../routes/document-generation.ts", import.meta.url), "utf8");
  const start = source.indexOf('if (action === "delete_output")');
  const end = source.indexOf("const result = await db.transaction", start + 40);
  const claimAndProvider = source.slice(start, end);
  assert.match(claimAndProvider, /orphanRecoveryClaim: ownedClaim[\s\S]*?return \{ run, orphan \};\s*\}\);/);
  assert.match(claimAndProvider, /const connection = await getConnection\(\)[\s\S]*?trashDriveFile/);
  assert.ok(claimAndProvider.indexOf("const connection = await getConnection()") > claimAndProvider.indexOf("return { run, orphan };"));
  assert.match(source.slice(end, source.indexOf("if (audit)", end)), /lockGdriveFileIds[\s\S]*?withoutRecoveryClaim[\s\S]*?orphanResolution/);
});

test("source template download is admin-gated and serves stored bytes as an attachment", async () => {
  const source = await readFile(new URL("../routes/document-generation.ts", import.meta.url), "utf8");
  const start = source.indexOf('router.get("/document-template-revisions/:id/download"');
  const end = source.indexOf('router.post("/document-template-revisions/:id/publish"', start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireAuth,\s*requireAdmin\("documentGeneration"\)/);
  assert.match(route, /readLocalFile\(revision\.templatePath\)/);
  assert.match(route, /res\.attachment\(revision\.templateName/);
  assert.match(route, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(route, /res\.(?:redirect|sendFile)\(/);
});
