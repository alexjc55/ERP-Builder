import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalGdriveFileIdUnion,
  canonicalGdriveFileIds,
  isDeletedDriveOrphanOutput,
  newlyIntroducedGdriveFileIds,
  lockGdriveFileIds,
} from "./gdrive-file-reference-lock";

test("collects nested canonical Google Drive IDs only", () => {
  const value = {
    file: { kind: "gdrive", fileId: " a " },
    nested: [{ kind: "gdrive", fileId: "b" }, { kind: "gdrive", fileId: "" }],
    impostor: { kind: "server", fileId: "not-drive" },
    text: "a",
  };
  assert.deepEqual(canonicalGdriveFileIds(value), ["a", "b"]);
});

test("lock helper deduplicates once and reports canonical acquisition order", async () => {
  const calls: unknown[] = [];
  const executor = { execute: async (query: unknown) => { calls.push(query); } };
  const locked = await lockGdriveFileIds(executor, ["z", "a", "z", " b "]);
  assert.deepEqual(locked, ["a", "b", "z"]);
  assert.equal(calls.length, 3);
});

test("Drive ID collection is deterministic and deduplicated", () => {
  assert.deepEqual(canonicalGdriveFileIds([{ kind: "gdrive", fileId: "z" }, { kind: "gdrive", fileId: "a" }, { kind: "gdrive", fileId: "z" }]), ["a", "z"]);
  assert.deepEqual(newlyIntroducedGdriveFileIds(
    { old: { kind: "gdrive", fileId: "a" } },
    { old: { kind: "gdrive", fileId: "a" }, new: { kind: "gdrive", fileId: "b" } },
  ), ["b"]);
  assert.deepEqual(canonicalGdriveFileIdUnion([
    { kind: "gdrive", fileId: "z" },
    [{ kind: "gdrive", fileId: "b" }, { kind: "gdrive", fileId: "z" }],
    { nested: { kind: "gdrive", fileId: "a" } },
  ]), ["a", "b", "z"]);
});

test("deleted orphan predicate requires exact structured file ID and outcome", () => {
  const deleted = { file: { kind: "gdrive", fileId: "abc" }, orphanResolution: { outcome: "deleted" } };
  assert.equal(isDeletedDriveOrphanOutput(deleted, "abc"), true);
  assert.equal(isDeletedDriveOrphanOutput(deleted, "ab"), false);
  assert.equal(isDeletedDriveOrphanOutput({ ...deleted, orphanResolution: { outcome: "attached" } }, "abc"), false);
});

test("active delete claims are tombstones but retry claims are not", () => {
  const file = { kind: "gdrive", fileId: "abc" };
  assert.equal(isDeletedDriveOrphanOutput({
    file,
    orphanRecoveryClaim: { action: "delete_output", leaseUntil: "2000-01-01T00:00:00.000Z" },
  }, "abc"), true);
  assert.equal(isDeletedDriveOrphanOutput({
    file,
    orphanRecoveryClaim: { action: "retry_writeback" },
  }, "abc"), false);
});