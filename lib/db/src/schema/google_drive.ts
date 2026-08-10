import { pgTable, serial, text, timestamp, integer, boolean, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";

/** Which OAuth client credentials are used for the Drive connection. */
export type GoogleDriveKeyMode = "builtin" | "own";

/**
 * Single-row table holding the platform's Google Drive connection. There is at
 * most one connection (id = 1). Secrets (own client secret + refresh token) are
 * stored AES-256-GCM encrypted (see lib/crypto.ts); plaintext is never persisted.
 *
 * - keyMode "builtin": use the platform's env OAuth client (GOOGLE_OAUTH_CLIENT_ID/SECRET).
 * - keyMode "own": use the admin-provided client id/secret stored here.
 *
 * `refreshTokenEnc` present ⇒ connected. `folderId` present ⇒ an upload target
 * folder is configured (auto-created on connect, can be changed later).
 */
export const googleDriveConnectionTable = pgTable("google_drive_connection", {
  id: serial("id").primaryKey(),
  keyMode: text("key_mode").$type<GoogleDriveKeyMode>().notNull().default("builtin"),
  ownClientId: text("own_client_id"),
  ownClientSecretEnc: text("own_client_secret_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  accountEmail: text("account_email"),
  folderId: text("folder_id"),
  folderName: text("folder_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GoogleDriveConnection = typeof googleDriveConnectionTable.$inferSelect;

/**
 * Managed Google Drive upload folders. Each row is an app-created folder (within
 * the narrow `drive.file` scope — the app only ever sees folders it created), so
 * admins can organize uploads without granting broad Drive access. A file field
 * binds to one of these folders via `fileConfigJson.driveFolderId`; when unset,
 * uploads fall back to the connection's default folder (`isDefault` = the
 * auto-created "ERP Uploads"). `driveFolderId` is Google's folder id.
 */
/**
 * One section of a managed folder's file-name template. When a folder has a
 * non-empty template, files uploaded into it are renamed by concatenating the
 * resolved sections with "_" and keeping the original file extension.
 * - "text": a fixed literal typed by the admin.
 * - "field": the current record's value for one of several candidate field keys
 *   (entity or page-local fields from DIFFERENT entities may feed the same
 *   folder, e.g. "order number" exists under a different key in each entity).
 *   `fieldKey` is the primary candidate, `alts` are fallbacks — at upload time
 *   the FIRST candidate with a non-empty value in the form draft wins. Labels
 *   are display-only snapshots for the admin UI.
 * - "hash": a random short alphanumeric id generated per upload.
 */
export type DriveNameSection =
  | { kind: "text"; text: string }
  | { kind: "field"; fieldKey: string; label?: string; alts?: { fieldKey: string; label?: string }[] }
  | { kind: "hash" }
  | { kind: "date" };

export const googleDriveFoldersTable = pgTable("google_drive_folders", {
  id: serial("id").primaryKey(),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  name: text("name").notNull(),
  // Null/empty = upload files with their original name (no template).
  nameTemplateJson: jsonb("name_template_json").$type<DriveNameSection[] | null>(),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  // Optional parent for nested folders (subfolders). Self-referencing FK; when a
  // folder is removed its descendant rows are removed too (the Drive folders
  // themselves are never deleted). Null = top-level folder.
  parentId: integer("parent_id").references((): AnyPgColumn => googleDriveFoldersTable.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GoogleDriveFolder = typeof googleDriveFoldersTable.$inferSelect;
