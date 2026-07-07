import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, localFoldersTable, type LocalFolder } from "@workspace/db";
import { CreateLocalFolderBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import { ensureDefaultLocalFolder } from "../lib/localFolders";
import { ensureLocalFolderDir } from "../lib/localStorage";

const router: IRouter = Router();

/** Public-facing managed folder shape (never leaks the on-disk storageDir). */
function folderInfo(f: LocalFolder) {
  return { id: f.id, name: f.name, isDefault: f.isDefault, parentId: f.parentId };
}

/**
 * GET /local-folders — list managed LOCAL upload folders (admin). Ensures the
 * default folder exists so a file field always has a fallback target.
 */
router.get("/local-folders", requireAuth, requireAdmin("settings"), async (_req, res): Promise<void> => {
  await ensureDefaultLocalFolder();
  const rows = await db
    .select()
    .from(localFoldersTable)
    .orderBy(desc(localFoldersTable.isDefault), localFoldersTable.sortOrder, localFoldersTable.id);
  res.json(rows.map(folderInfo));
});

/** POST /local-folders — create a new managed local folder (admin). */
router.post("/local-folders", requireAuth, requireAdmin("settings"), async (req, res): Promise<void> => {
  const parsed = CreateLocalFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Folder name is required" });
    return;
  }
  const parentId = parsed.data.parentId ?? null;
  // A subfolder must nest under an existing managed folder (never trust an
  // arbitrary id from the client).
  if (parentId != null) {
    const [parent] = await db
      .select({ id: localFoldersTable.id })
      .from(localFoldersTable)
      .where(eq(localFoldersTable.id, parentId))
      .limit(1);
    if (!parent) {
      res.status(400).json({ error: "Parent folder not found" });
      return;
    }
  }
  const storageDir = randomUUID();
  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${localFoldersTable.sortOrder}), 0)` })
    .from(localFoldersTable);
  const [row] = await db
    .insert(localFoldersTable)
    .values({ storageDir, name, sortOrder: (maxRow?.max ?? 0) + 1, parentId })
    .returning();
  await ensureLocalFolderDir(row.storageDir);
  res.json(folderInfo(row));
});

/**
 * DELETE /local-folders/:id — remove a managed folder from the list (admin). The
 * default folder cannot be removed. Descendant rows cascade. The physical files
 * on disk are left in place; any field still bound to a removed folder falls back
 * to the default at upload time.
 */
router.delete("/local-folders/:id", requireAuth, requireAdmin("settings"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const [row] = await db.select().from(localFoldersTable).where(eq(localFoldersTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  if (row.isDefault) {
    res.status(400).json({ error: "Cannot remove the default folder" });
    return;
  }
  await db.delete(localFoldersTable).where(eq(localFoldersTable.id, id));
  res.json({ success: true });
});

export default router;
