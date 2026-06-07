import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
