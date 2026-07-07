import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, boolean, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Managed LOCAL upload folders (Google-Drive-style organization for files stored
 * on the server's own disk under `uploads/files/`). Each row is a logical folder
 * an admin creates from the Settings screen; a file field binds to one via
 * `fileConfigJson.localFolderId`, and when unset uploads fall back to the default
 * folder (`isDefault` = the auto-created "Общая").
 *
 * `storageDir` is a stable, opaque directory name (a UUID) on disk under
 * `uploads/files/<storageDir>/`. It never changes when the folder is renamed, so
 * a rename is a DB-only operation and stored file paths stay valid.
 */
export const localFoldersTable = pgTable("local_folders", {
  id: serial("id").primaryKey(),
  // Opaque on-disk directory name under uploads/files/. Stable across renames.
  storageDir: text("storage_dir").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  // Optional parent for nested folders (subfolders). Self-referencing FK; when a
  // folder is removed its descendant rows are removed too. The physical files on
  // disk are left in place (never auto-deleted). Null = top-level folder.
  parentId: integer("parent_id").references((): AnyPgColumn => localFoldersTable.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // At most one default folder: guards against a concurrent-first-upload race
  // (two callers both find no default and both insert) on a fresh deploy.
  uniqueIndex("local_folders_single_default_idx")
    .on(table.isDefault)
    .where(sql`${table.isDefault} = true`),
]);

export type LocalFolder = typeof localFoldersTable.$inferSelect;
