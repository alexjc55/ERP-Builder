import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq, desc, inArray } from "drizzle-orm";
import { db, deletedFilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireSuperAdmin } from "../middlewares/permissions";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { isLocalPath, streamLocalFile, deleteLocalFile } from "../lib/localStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * File trash (recycle bin) for files removed from records. Rows are created on
 * the records delete/update path; the physical objects live on until purged
 * here. SuperAdmin-only — listing exposes file metadata across all entities,
 * bypassing the per-record boundary, so it must not be broader. Files may be
 * stored locally on disk (`/local/...`) or in legacy object storage
 * (`/objects/...`); each op below branches on the path. Google Drive and pasted
 * links are never tracked or deleted.
 */

/**
 * Delete a trashed file's physical object, branching on where it lives. Local
 * deletes are best-effort (a missing file is a no-op); object-storage deletes
 * bubble up so the caller can leave the trash row recoverable on failure.
 */
async function deletePhysical(filePath: string): Promise<void> {
  if (isLocalPath(filePath)) {
    await deleteLocalFile(filePath);
    return;
  }
  await objectStorageService.deleteObjectEntity(filePath);
}

/** Map a DB row to the API shape (name snapshots are exposed under shorter keys). */
function toApi(row: typeof deletedFilesTable.$inferSelect) {
  return {
    id: row.id,
    entityId: row.entityId,
    entityName: (row.entityNameJson as Record<string, unknown> | null) ?? null,
    recordId: row.recordId,
    fieldKey: row.fieldKey,
    fieldName: (row.fieldNameJson as Record<string, unknown> | null) ?? null,
    fileName: row.fileName,
    filePath: row.filePath,
    fileSize: row.fileSize,
    contentType: row.contentType,
    reason: row.reason,
    deletedBy: row.deletedBy,
    deletedAt: row.deletedAt.toISOString(),
  };
}

router.get("/deleted-files", requireAuth, requireSuperAdmin(), async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(deletedFilesTable)
    .orderBy(desc(deletedFilesTable.deletedAt), desc(deletedFilesTable.id));
  res.json(rows.map(toApi));
});

/**
 * Stream a trashed file's bytes for download/recovery. The physical object is
 * still present until purged, so this works even when its source record is gone.
 */
router.get(
  "/deleted-files/:id/content",
  requireAuth,
  requireSuperAdmin(),
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db.select().from(deletedFilesTable).where(eq(deletedFilesTable.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Trashed file not found" });
      return;
    }
    try {
      if (isLocalPath(row.filePath)) {
        const ok = await streamLocalFile(res, row.filePath, { contentType: row.contentType });
        if (!ok) {
          res.status(404).json({ error: "File no longer exists in storage" });
        }
        return;
      }
      const objectFile = await objectStorageService.getObjectEntityFile(row.filePath);
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File no longer exists in storage" });
        return;
      }
      req.log.error({ err: error }, "Error serving trashed file");
      res.status(500).json({ error: "Failed to serve file" });
    }
  },
);

router.post(
  "/deleted-files/purge-all",
  requireAuth,
  requireSuperAdmin(),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db.select().from(deletedFilesTable);
    // Only drop the trash row once its physical object is actually gone, so a
    // transient storage failure leaves the entry recoverable/retryable rather
    // than orphaning the blob with no reference to it.
    const purgedIds: number[] = [];
    for (const row of rows) {
      try {
        await deletePhysical(row.filePath);
        purgedIds.push(row.id);
      } catch (error) {
        req.log.error({ err: error, filePath: row.filePath }, "Failed to delete object during purge");
      }
    }
    if (purgedIds.length > 0) {
      await db.delete(deletedFilesTable).where(inArray(deletedFilesTable.id, purgedIds));
    }
    res.json({ success: true });
  },
);

router.delete(
  "/deleted-files/:id",
  requireAuth,
  requireSuperAdmin(),
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db.select().from(deletedFilesTable).where(eq(deletedFilesTable.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Trashed file not found" });
      return;
    }
    // Remove the physical object first; only drop the trash row on success so a
    // storage failure stays recoverable instead of orphaning the blob.
    try {
      await deletePhysical(row.filePath);
    } catch (error) {
      req.log.error({ err: error, filePath: row.filePath }, "Failed to delete object from storage");
      res.status(500).json({ error: "Failed to delete file from storage" });
      return;
    }
    await db.delete(deletedFilesTable).where(eq(deletedFilesTable.id, id));
    res.json({ success: true });
  },
);

export default router;
