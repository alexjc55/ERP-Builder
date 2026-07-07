import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, localFoldersTable, type LocalFolder } from "@workspace/db";
import { ensureLocalFolderDir } from "./localStorage";

/** Human-readable name of the auto-created default local folder. */
const DEFAULT_FOLDER_NAME = "Общая";

/**
 * Return the default local upload folder, creating it (with its on-disk
 * directory) on first use. There is always exactly one default; file uploads
 * with no bound folder land here.
 */
export async function ensureDefaultLocalFolder(): Promise<LocalFolder> {
  const [existing] = await db
    .select()
    .from(localFoldersTable)
    .where(eq(localFoldersTable.isDefault, true))
    .limit(1);
  if (existing) {
    await ensureLocalFolderDir(existing.storageDir);
    return existing;
  }
  const storageDir = randomUUID();
  let row: LocalFolder;
  try {
    [row] = await db
      .insert(localFoldersTable)
      .values({ storageDir, name: DEFAULT_FOLDER_NAME, isDefault: true, sortOrder: 0 })
      .returning();
  } catch {
    // Lost a concurrent-first-upload race: the single-default unique index
    // rejected our insert because another caller created the default. Re-read it.
    const [winner] = await db
      .select()
      .from(localFoldersTable)
      .where(eq(localFoldersTable.isDefault, true))
      .limit(1);
    if (!winner) throw new Error("Failed to create or find default local folder");
    await ensureLocalFolderDir(winner.storageDir);
    return winner;
  }
  await ensureLocalFolderDir(row.storageDir);
  return row;
}

/**
 * Resolve the on-disk `storageDir` for a requested folder id. Validates the id
 * is one of our managed folders (never trust an arbitrary id from the client);
 * falls back to the default folder when unset or unknown. The target directory
 * is created if missing.
 */
export async function resolveTargetStorageDir(requestedFolderId?: number | null): Promise<string> {
  if (requestedFolderId != null && Number.isInteger(requestedFolderId)) {
    const [managed] = await db
      .select({ storageDir: localFoldersTable.storageDir })
      .from(localFoldersTable)
      .where(eq(localFoldersTable.id, requestedFolderId))
      .limit(1);
    if (managed) {
      await ensureLocalFolderDir(managed.storageDir);
      return managed.storageDir;
    }
  }
  const def = await ensureDefaultLocalFolder();
  return def.storageDir;
}
