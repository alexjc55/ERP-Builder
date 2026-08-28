import { sql } from "drizzle-orm";
import { documentGenerationRunsTable } from "@workspace/db";

/** Separate advisory-lock namespace for Drive object lifetime coordination. */
export const GDRIVE_FILE_REFERENCE_LOCK_NS = 1_147_291_841;

/** A Drive output was terminally trashed while this transaction was waiting. */
export class DriveFileTombstonedError extends Error {
  constructor(readonly fileId: string) {
    super(`Google Drive file "${fileId}" was deleted as an orphan and cannot be referenced`);
    this.name = "DriveFileTombstonedError";
  }
}

type SqlExecutor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

/** Recursively find only structurally valid Drive file references. */
export function canonicalGdriveFileIds(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const obj = current as Record<string, unknown>;
    if (obj.kind === "gdrive" && typeof obj.fileId === "string" && obj.fileId.trim() !== "") {
      found.add(obj.fileId.trim());
    }
    Object.values(obj).forEach(visit);
  };
  visit(value);
  return [...found].sort();
}

export function newlyIntroducedGdriveFileIds(oldValues: unknown, newValues: unknown): string[] {
  const oldIds = new Set(canonicalGdriveFileIds(oldValues));
  return canonicalGdriveFileIds(newValues).filter((id) => !oldIds.has(id));
}

export function canonicalGdriveFileIdUnion(values: Iterable<unknown>): string[] {
  return [...new Set([...values].flatMap(canonicalGdriveFileIds))].sort();
}

/** Hold the shared per-file transaction lock in lexical order. */
export async function lockGdriveFileIds(tx: SqlExecutor, fileIds: Iterable<string>): Promise<string[]> {
  const ids = [...new Set([...fileIds].filter((id) => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))].sort();
  for (const fileId of ids) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GDRIVE_FILE_REFERENCE_LOCK_NS}, hashtext(${fileId}))`);
  }
  return ids;
}

export function isDeletedDriveOrphanOutput(output: unknown, fileId: string): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  const root = output as Record<string, unknown>;
  const file = root.file;
  const resolution = root.orphanResolution;
  const claim = root.orphanRecoveryClaim;
  return !!file && typeof file === "object" && !Array.isArray(file) &&
    (file as Record<string, unknown>).fileId === fileId &&
    ((!!resolution && typeof resolution === "object" && !Array.isArray(resolution) &&
      (resolution as Record<string, unknown>).outcome === "deleted") ||
     (!!claim && typeof claim === "object" && !Array.isArray(claim) &&
      (claim as Record<string, unknown>).action === "delete_output"));
}

/** Validate newly introduced IDs after their shared locks are already held. */
export async function validateGdriveFileReferencesUnderLock(
  tx: SqlExecutor,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  const oldIds = canonicalGdriveFileIds(oldValues);
  const newIds = canonicalGdriveFileIds(newValues);
  const introduced = newIds.filter((id) => !oldIds.includes(id));
  for (const fileId of introduced) {
    const rows = await tx.execute(sql`
      SELECT 1 FROM ${documentGenerationRunsTable}
      WHERE (${documentGenerationRunsTable.outputJson} #>> '{file,fileId}') = ${fileId}
        AND (
          (${documentGenerationRunsTable.outputJson} #>> '{orphanResolution,outcome}') = 'deleted'
          OR (${documentGenerationRunsTable.outputJson} #>> '{orphanRecoveryClaim,action}') = 'delete_output'
        )
      LIMIT 1
    `) as { rows?: unknown[] };
    if ((rows.rows?.length ?? 0) > 0) throw new DriveFileTombstonedError(fileId);
  }
}

/** Lock and validate only IDs made newly reachable by this transition. */
export async function lockAndValidateGdriveFileReferences(
  tx: SqlExecutor,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  // Only a newly reachable ID participates in the lifetime race. Preserved and
  // removed references cannot resurrect a trashed object, and locking them can
  // create reversed lock order when a transaction performs several writes.
  await lockGdriveFileIds(tx, newlyIntroducedGdriveFileIds(oldValues, newValues));
  await validateGdriveFileReferencesUnderLock(tx, oldValues, newValues);
}