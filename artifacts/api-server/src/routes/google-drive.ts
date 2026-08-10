import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { Readable } from "stream";
import jwt from "jsonwebtoken";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  googleDriveConnectionTable,
  googleDriveFoldersTable,
  entityRecordsTable,
  entityFieldsTable,
  mirrorPermKey,
  type GoogleDriveConnection,
  type GoogleDriveFolder,
  type DriveNameSection,
  type EntityField,
} from "@workspace/db";
import { UpdateGoogleDriveConnectionBody, CreateGoogleDriveFolderBody, UpdateGoogleDriveFolderBody, RenameGoogleDriveFileBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import {
  requireAdmin,
  getPermissions,
  getUserRoleIds,
  canRecord,
  effectiveScope,
  effectiveScopeFor,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { isRecordOwned } from "./own-scope";
import { encryptSecret } from "../lib/crypto";
import { APP_SECRET } from "../lib/secret";
import {
  DRIVE_CONNECTION_ID,
  builtinCredsAvailable,
  driveRedirectUri,
  resolveCreds,
  getConnection,
  buildAuthUrl,
  exchangeCode,
  getAccessToken,
  ensureFolder,
  createDriveFolder,
  uploadToFolder,
  downloadDriveFile,
  renameDriveFile,
  fetchDriveThumbnail,
  saveConnectionTokens,
  isGoogleDriveModuleEnabled,
} from "../lib/googleDrive";

const router: IRouter = Router();

const SECRET = APP_SECRET;
const OAUTH_STATE_PURPOSE = "gdrive-oauth";
const SETTINGS_PATH = "/admin/google-drive";

/** Ensure the single connection row exists, returning it. */
async function ensureConnectionRow(): Promise<GoogleDriveConnection> {
  const existing = await getConnection();
  if (existing) return existing;
  const [row] = await db
    .insert(googleDriveConnectionTable)
    .values({ id: DRIVE_CONNECTION_ID })
    .onConflictDoNothing()
    .returning();
  return row ?? (await getConnection())!;
}

/** Public-facing connection info (never leaks secrets). */
function connectionInfo(conn: GoogleDriveConnection, req: Request) {
  return {
    keyMode: conn.keyMode,
    connected: Boolean(conn.refreshTokenEnc),
    folderConfigured: Boolean(conn.folderId),
    builtinAvailable: builtinCredsAvailable(),
    hasOwnCreds: Boolean(conn.ownClientId && conn.ownClientSecretEnc),
    redirectUri: driveRedirectUri(req),
    ...(conn.ownClientId ? { ownClientId: conn.ownClientId } : {}),
    ...(conn.accountEmail ? { accountEmail: conn.accountEmail } : {}),
    ...(conn.folderId ? { folderId: conn.folderId } : {}),
    ...(conn.folderName ? { folderName: conn.folderName } : {}),
  };
}

/**
 * GET /google-drive/status — lightweight readiness for record forms. Any
 * authenticated user may read whether Drive uploads are available.
 */
router.get("/google-drive/status", requireAuth, async (_req, res): Promise<void> => {
  const [conn, enabled] = await Promise.all([getConnection(), isGoogleDriveModuleEnabled()]);
  res.json({
    connected: Boolean(conn?.refreshTokenEnc),
    folderConfigured: Boolean(conn?.folderId),
    enabled,
  });
});

/** GET /google-drive/connection — full info (admin). */
router.get("/google-drive/connection", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  const conn = await ensureConnectionRow();
  res.json(connectionInfo(conn, req));
});

/** PUT /google-drive/connection — set key mode + own credentials (admin). */
router.put("/google-drive/connection", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  const parsed = UpdateGoogleDriveConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensureConnectionRow();
  const { keyMode, ownClientId, ownClientSecret } = parsed.data;
  const update: Partial<typeof googleDriveConnectionTable.$inferInsert> = { keyMode };
  if (ownClientId !== undefined) update.ownClientId = ownClientId.trim() || null;
  if (ownClientSecret !== undefined && ownClientSecret.trim()) {
    update.ownClientSecretEnc = encryptSecret(ownClientSecret.trim());
  }
  const [row] = await db
    .update(googleDriveConnectionTable)
    .set(update)
    .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID))
    .returning();
  res.json(connectionInfo(row, req));
});

/** POST /google-drive/oauth/start — build the consent URL (admin). */
router.post("/google-drive/oauth/start", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  const conn = await ensureConnectionRow();
  const creds = resolveCreds(conn);
  if (!creds) {
    res.status(400).json({
      error:
        conn.keyMode === "own"
          ? "Own OAuth client credentials are not configured"
          : "Built-in Google OAuth credentials are not available; switch to own keys",
    });
    return;
  }
  const state = jwt.sign({ purpose: OAUTH_STATE_PURPOSE, uid: req.user!.userId }, SECRET, { expiresIn: "10m" });
  res.json({ authUrl: buildAuthUrl(creds, state, driveRedirectUri(req)) });
});

/**
 * GET /google-drive/oauth/callback — browser redirect target. Validates state,
 * exchanges the code, stores the refresh token, ensures the upload folder, then
 * redirects back to the settings page. Not part of the generated client.
 */
router.get("/google-drive/oauth/callback", async (req: Request, res: Response): Promise<void> => {
  const redirectBack = (status: "connected" | "error") =>
    res.redirect(`${SETTINGS_PATH}?drive=${status}`);
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      redirectBack("error");
      return;
    }
    try {
      const decoded = jwt.verify(state, SECRET) as { purpose?: string };
      if (decoded.purpose !== OAUTH_STATE_PURPOSE) throw new Error("bad state");
    } catch {
      redirectBack("error");
      return;
    }
    const conn = await ensureConnectionRow();
    const creds = resolveCreds(conn);
    if (!creds) {
      redirectBack("error");
      return;
    }
    const { refreshToken, accessToken, email } = await exchangeCode(creds, code, driveRedirectUri(req));
    await saveConnectionTokens(refreshToken, email);
    const folder = await ensureFolder(accessToken, conn.folderId);
    await db
      .update(googleDriveConnectionTable)
      .set({ folderId: folder.id, folderName: folder.name })
      .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID));
    // Register the default upload folder in the managed-folders list (idempotent).
    // Demote any stale default first so exactly one row stays isDefault=true even
    // if the underlying Drive folder rotated between connects.
    await db
      .update(googleDriveFoldersTable)
      .set({ isDefault: false })
      .where(eq(googleDriveFoldersTable.isDefault, true));
    await db
      .insert(googleDriveFoldersTable)
      .values({ driveFolderId: folder.id, name: folder.name, isDefault: true, sortOrder: 0 })
      .onConflictDoUpdate({
        target: googleDriveFoldersTable.driveFolderId,
        set: { name: folder.name, isDefault: true },
      });
    redirectBack("connected");
  } catch (err) {
    req.log.error({ err }, "Google Drive OAuth callback failed");
    redirectBack("error");
  }
});

/** POST /google-drive/disconnect — clear tokens, creds secret, folder (admin). */
router.post("/google-drive/disconnect", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  await ensureConnectionRow();
  const [row] = await db
    .update(googleDriveConnectionTable)
    .set({ refreshTokenEnc: null, accountEmail: null, folderId: null, folderName: null })
    .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID))
    .returning();
  // Drop the managed-folder list too; the Drive folders themselves are left
  // untouched (the platform never deletes Drive content).
  await db.delete(googleDriveFoldersTable);
  res.json(connectionInfo(row, req));
});

/** Public-facing managed folder shape. */
function folderInfo(f: GoogleDriveFolder) {
  return {
    id: f.id,
    driveFolderId: f.driveFolderId,
    name: f.name,
    isDefault: f.isDefault,
    parentId: f.parentId,
    nameTemplateJson: f.nameTemplateJson ?? null,
  };
}

/** GET /google-drive/folders — list managed upload folders (admin). */
router.get("/google-drive/folders", requireAuth, requireAdmin("googleDrive"), async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(googleDriveFoldersTable)
    .orderBy(desc(googleDriveFoldersTable.isDefault), googleDriveFoldersTable.sortOrder, googleDriveFoldersTable.id);
  res.json(rows.map(folderInfo));
});

/** POST /google-drive/folders — create a new managed Drive folder (admin). */
router.post("/google-drive/folders", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  const parsed = CreateGoogleDriveFolderBody.safeParse(req.body);
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
  const conn = await getConnection();
  if (!conn?.refreshTokenEnc) {
    res.status(409).json({ error: "Google Drive is not connected" });
    return;
  }
  try {
    // A subfolder must nest under an existing managed folder (never trust an
    // arbitrary Drive folder id from the client).
    let parentDriveFolderId: string | undefined;
    if (parentId != null) {
      const [parent] = await db
        .select({ driveFolderId: googleDriveFoldersTable.driveFolderId })
        .from(googleDriveFoldersTable)
        .where(eq(googleDriveFoldersTable.id, parentId));
      if (!parent) {
        res.status(400).json({ error: "Parent folder not found" });
        return;
      }
      parentDriveFolderId = parent.driveFolderId;
    }
    const accessToken = await getAccessToken(conn);
    const folder = await createDriveFolder(accessToken, name, parentDriveFolderId);
    const [maxRow] = await db
      .select({ max: sql<number>`coalesce(max(${googleDriveFoldersTable.sortOrder}), 0)` })
      .from(googleDriveFoldersTable);
    const [row] = await db
      .insert(googleDriveFoldersTable)
      .values({ driveFolderId: folder.id, name: folder.name, sortOrder: (maxRow?.max ?? 0) + 1, parentId })
      .returning();
    res.json(folderInfo(row));
  } catch (err) {
    req.log.error({ err }, "Failed to create Google Drive folder");
    res.status(502).json({ error: "Failed to create Google Drive folder" });
  }
});

/**
 * PUT /google-drive/folders/:id — update a managed folder's file-name template
 * (admin). Null/empty template = uploads keep their original file names.
 */
router.put("/google-drive/folders/:id", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const parsed = UpdateGoogleDriveFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const raw = parsed.data.nameTemplateJson ?? [];
  // Drop degenerate sections (empty text / missing fieldKey), normalize to the
  // discriminated DB shape, and cap size.
  const sections: DriveNameSection[] = [];
  for (const s of raw) {
    if (s.kind === "text") {
      const text = s.text?.trim();
      if (text) sections.push({ kind: "text", text });
    } else if (s.kind === "field") {
      const fieldKey = s.fieldKey?.trim();
      const alts = (s.alts ?? [])
        .map((a) => ({ fieldKey: a.fieldKey.trim(), label: a.label }))
        .filter((a) => a.fieldKey && a.fieldKey !== fieldKey);
      if (fieldKey) sections.push({ kind: "field", fieldKey, label: s.label, alts: alts.length > 0 ? alts : undefined });
    } else if (s.kind === "hash") {
      sections.push({ kind: "hash" });
    } else if (s.kind === "date") {
      sections.push({ kind: "date" });
    } else if (s.kind === "user") {
      sections.push({ kind: "user" });
    }
  }
  if (sections.length > 10) {
    res.status(400).json({ error: "Too many template sections" });
    return;
  }
  const [row] = await db
    .update(googleDriveFoldersTable)
    .set({ nameTemplateJson: sections.length > 0 ? sections : null })
    .where(eq(googleDriveFoldersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  res.json(folderInfo(row));
});

/**
 * GET /google-drive/name-template — the file-name template for a managed folder,
 * readable by ANY authenticated user (record editors need it at upload time; the
 * folders LIST stays admin-only). Unknown/omitted folder id falls back to the
 * default upload folder, mirroring the upload route's folder resolution.
 */
router.get("/google-drive/name-template", requireAuth, async (req, res): Promise<void> => {
  const driveFolderId = typeof req.query.driveFolderId === "string" ? req.query.driveFolderId : undefined;
  let row: GoogleDriveFolder | undefined;
  if (driveFolderId) {
    [row] = await db.select().from(googleDriveFoldersTable).where(eq(googleDriveFoldersTable.driveFolderId, driveFolderId));
  }
  if (!row) {
    [row] = await db.select().from(googleDriveFoldersTable).where(eq(googleDriveFoldersTable.isDefault, true));
  }
  res.json({ sections: row?.nameTemplateJson ?? [] });
});

/**
 * DELETE /google-drive/folders/:id — remove a managed folder from the list
 * (admin). The default folder cannot be removed. The Drive folder itself is left
 * in place; any field still bound to it falls back to the default at upload time.
 */
router.delete("/google-drive/folders/:id", requireAuth, requireAdmin("googleDrive"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const [row] = await db.select().from(googleDriveFoldersTable).where(eq(googleDriveFoldersTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  if (row.isDefault) {
    res.status(400).json({ error: "Cannot remove the default folder" });
    return;
  }
  await db.delete(googleDriveFoldersTable).where(eq(googleDriveFoldersTable.id, id));
  res.json({ success: true });
});

/**
 * POST /google-drive/upload — upload a file into the managed folder. The file is
 * sent as the raw request body (Content-Type = file type, X-File-Name header
 * carries the URL-encoded name) to avoid a multipart parser dependency. The
 * server holds the Drive credentials; the client never sees a token. Returns the
 * POST /google-drive/rename — rename a Drive file AFTER the record was saved,
 * so the name reflects the FINAL field values (fields may be filled after the
 * file was uploaded mid-form). The client composes the name from the template;
 * the server re-checks the record EDIT boundary (record cap + field edit access
 * + own scope) and verifies the file is actually the one stored in that field,
 * then renames in Drive and updates the stored value's name.
 */
router.post("/google-drive/rename", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = RenameGoogleDriveFileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { recordId, fieldKey, fileId } = parsed.data;
    // Same sanitization spirit as the client: strip filesystem-hostile chars.
    const name = parsed.data.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!name) {
      res.status(400).json({ error: "Empty file name" });
      return;
    }
    const [rec] = await db
      .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(eq(entityRecordsTable.id, recordId));
    if (!rec) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    const pageId = parsed.data.pageId ?? undefined;
    const perms = await getPermissions(req);
    // Same boundary as record updates: a mirror-page CRUD override (when the
    // caller works through an authorized mirror page) replaces the entity perm.
    const mirrorOverride =
      pageId != null && (perms.pageIds?.includes(pageId) ?? false)
        ? perms.records[mirrorPermKey(pageId)]
        : undefined;
    const mayUpdate = mirrorOverride ? mirrorOverride.update === true : canRecord(perms, rec.entityId, "update");
    if (!mayUpdate) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    const fields = await db
      .select()
      .from(entityFieldsTable)
      .where(and(eq(entityFieldsTable.entityId, rec.entityId), eq(entityFieldsTable.isActive, true)));
    const holder = fields.find((f) => f.fieldType === "file" && f.fieldKey === fieldKey);
    if (!holder) {
      res.status(404).json({ error: "Field not found" });
      return;
    }
    const roleIds = await getUserRoleIds(req);
    if (resolveFieldAccess(holder, perms, roleIds, rec.entityId, mirrorOverride, pageId) !== "edit") {
      res.status(403).json({ error: "No edit access to this field" });
      return;
    }
    const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, rec.entityId, pageId);
    if (scope === "own" && !(await isRecordOwned(rec.entityId, rec, scopeFieldKeys, req.user!.userId, fields))) {
      res.status(403).json({ error: "No edit access to this record" });
      return;
    }
    const values = (rec.valuesJson as Record<string, unknown>) ?? {};
    if (!gdriveValueRefersTo(values[fieldKey], fileId)) {
      res.status(404).json({ error: "File is not referenced by this field" });
      return;
    }
    const conn = await getConnection();
    if (!conn?.refreshTokenEnc) {
      res.status(409).json({ error: "Google Drive is not connected" });
      return;
    }
    const accessToken = await getAccessToken(conn);
    const finalName = await renameDriveFile(accessToken, fileId, name);
    // Atomic, targeted JSON update: set only this field's name (and clear the
    // pendingRename flag), guarded on the SAME fileId still being stored — a
    // concurrent edit that replaced the file (or the whole record) is never
    // clobbered, unlike a read-modify-write of the full valuesJson document.
    await db.execute(sql`
      UPDATE entity_records
      SET values_json = jsonb_set(
        (values_json #- ARRAY[${fieldKey}::text, 'pendingRename']),
        ARRAY[${fieldKey}::text, 'name'],
        to_jsonb(${finalName}::text)
      )
      WHERE id = ${recordId}
        AND values_json -> ${fieldKey} ->> 'fileId' = ${fileId}
    `);
    res.json({ name: finalName });
  } catch (err) {
    req.log.error({ err }, "Google Drive rename failed");
    res.status(500).json({ error: "Failed to rename Drive file" });
  }
});

/**
 * created Drive file's metadata to store as a `gdrive` file value.
 */
router.post(
  "/google-drive/upload",
  requireAuth,
  express.raw({ type: () => true, limit: "50mb" }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!(await isGoogleDriveModuleEnabled())) {
        res.status(403).json({ error: "Google Drive module is disabled" });
        return;
      }
      const conn = await getConnection();
      if (!conn?.refreshTokenEnc || !conn.folderId) {
        res.status(409).json({ error: "Google Drive is not connected" });
        return;
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "Empty upload body" });
        return;
      }
      const rawName = req.header("x-file-name");
      const name = rawName ? decodeURIComponent(rawName) : "upload";
      const contentType = req.header("content-type") || "application/octet-stream";
      // A field may target a specific managed folder. Validate the requested id
      // is one of our managed folders (never trust an arbitrary folder id from
      // the client); otherwise fall back to the connection's default folder.
      let targetFolderId = conn.folderId;
      const requestedFolderId = req.header("x-drive-folder-id");
      if (requestedFolderId) {
        const [managed] = await db
          .select({ driveFolderId: googleDriveFoldersTable.driveFolderId })
          .from(googleDriveFoldersTable)
          .where(eq(googleDriveFoldersTable.driveFolderId, requestedFolderId));
        if (managed) targetFolderId = managed.driveFolderId;
      }
      const accessToken = await getAccessToken(conn);
      const file = await uploadToFolder(accessToken, targetFolderId, name, contentType, body);
      res.json(file);
    } catch (err) {
      req.log.error({ err }, "Google Drive upload failed");
      res.status(500).json({ error: "Failed to upload to Google Drive" });
    }
  },
);

/** True if a stored field value is a gdrive file object pointing at `fileId`. */
function gdriveValueRefersTo(value: unknown, fileId: string): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).kind === "gdrive" &&
    (value as Record<string, unknown>).fileId === fileId
  );
}

/**
 * Authorize a managed-Drive file read by mirroring the records permission
 * boundary (same as object storage): a user may read a Drive file only if it is
 * referenced by a record they may view through a non-hidden file field. Never
 * trust the fileId in the URL alone.
 */
async function canReadDriveFile(req: Request, fileId: string): Promise<boolean> {
  if (!req.user) return false;
  const candidates = await db
    .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(sql`${entityRecordsTable.valuesJson}::text LIKE ${"%" + fileId + "%"}`);
  if (candidates.length === 0) return false;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user.userId;
  const fieldsByEntity = new Map<number, EntityField[]>();

  for (const rec of candidates) {
    if (!canRecord(perms, rec.entityId, "view")) continue;
    let fields = fieldsByEntity.get(rec.entityId);
    if (!fields) {
      fields = await db
        .select()
        .from(entityFieldsTable)
        .where(and(eq(entityFieldsTable.entityId, rec.entityId), eq(entityFieldsTable.isActive, true)));
      fieldsByEntity.set(rec.entityId, fields);
    }
    const values = (rec.valuesJson as Record<string, unknown>) ?? {};
    const holder = fields.find(
      (f) => f.fieldType === "file" && gdriveValueRefersTo(values[f.fieldKey], fileId),
    );
    if (!holder) continue;
    if (resolveFieldAccess(holder, perms, roleIds, rec.entityId) === "hidden") continue;
    const { scope, scopeFieldKeys } = effectiveScope(perms, rec.entityId);
    if (scope === "own" && !(await isRecordOwned(rec.entityId, rec, scopeFieldKeys, userId, fields))) continue;
    return true;
  }
  return false;
}

/**
 * GET /google-drive/files/:id/content — auth-gated proxy that streams a managed
 * Drive file's bytes, re-applying the records permission boundary so it never
 * leaks a file a user could not have seen via the record itself.
 */
router.get("/google-drive/files/:id/content", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const fileId = String(req.params.id);
    if (!(await canReadDriveFile(req, fileId))) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const conn = await getConnection();
    if (!conn?.refreshTokenEnc) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const accessToken = await getAccessToken(conn);
    const file = await downloadDriveFile(accessToken, fileId);
    if (file.status !== 200 || !file.body) {
      res.status(file.status === 404 ? 404 : 502).json({ error: "File not found" });
      return;
    }
    if (file.contentType) res.setHeader("Content-Type", file.contentType);
    if (file.contentLength) res.setHeader("Content-Length", file.contentLength);
    Readable.fromWeb(file.body).pipe(res);
  } catch (err) {
    req.log.error({ err }, "Google Drive file proxy failed");
    res.status(500).json({ error: "Failed to fetch Drive file" });
  }
});

/**
 * GET /google-drive/files/:id/thumbnail — auth-gated proxy that streams a
 * Google-generated thumbnail (small, fast) for hover previews, re-applying the
 * same records permission boundary as the content route. Returns 404 when the
 * file has no thumbnail so the client falls back to the full-content preview.
 */
router.get("/google-drive/files/:id/thumbnail", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const fileId = String(req.params.id);
    if (!(await canReadDriveFile(req, fileId))) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const conn = await getConnection();
    if (!conn?.refreshTokenEnc) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const accessToken = await getAccessToken(conn);
    const thumb = await fetchDriveThumbnail(accessToken, fileId);
    if (!thumb || thumb.status !== 200 || !thumb.body) {
      res.status(404).json({ error: "No thumbnail" });
      return;
    }
    if (thumb.contentType) res.setHeader("Content-Type", thumb.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    Readable.fromWeb(thumb.body).pipe(res);
  } catch (err) {
    req.log.error({ err }, "Google Drive thumbnail proxy failed");
    res.status(500).json({ error: "Failed to fetch thumbnail" });
  }
});

export default router;
