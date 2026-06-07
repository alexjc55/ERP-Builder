import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { Readable } from "stream";
import jwt from "jsonwebtoken";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  googleDriveConnectionTable,
  entityRecordsTable,
  entityFieldsTable,
  type GoogleDriveConnection,
  type EntityField,
} from "@workspace/db";
import { UpdateGoogleDriveConnectionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import {
  requireAdmin,
  getPermissions,
  canRecord,
  effectiveScope,
  resolveFieldAccess,
  recordOwnedBy,
} from "../middlewares/permissions";
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
  uploadToFolder,
  downloadDriveFile,
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
function connectionInfo(conn: GoogleDriveConnection) {
  return {
    keyMode: conn.keyMode,
    connected: Boolean(conn.refreshTokenEnc),
    folderConfigured: Boolean(conn.folderId),
    builtinAvailable: builtinCredsAvailable(),
    hasOwnCreds: Boolean(conn.ownClientId && conn.ownClientSecretEnc),
    redirectUri: driveRedirectUri(),
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
router.get("/google-drive/connection", requireAuth, requireAdmin("googleDrive"), async (_req, res): Promise<void> => {
  const conn = await ensureConnectionRow();
  res.json(connectionInfo(conn));
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
  res.json(connectionInfo(row));
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
  res.json({ authUrl: buildAuthUrl(creds, state) });
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
    const { refreshToken, accessToken, email } = await exchangeCode(creds, code);
    await saveConnectionTokens(refreshToken, email);
    const folder = await ensureFolder(accessToken, conn.folderId);
    await db
      .update(googleDriveConnectionTable)
      .set({ folderId: folder.id, folderName: folder.name })
      .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID));
    redirectBack("connected");
  } catch (err) {
    req.log.error({ err }, "Google Drive OAuth callback failed");
    redirectBack("error");
  }
});

/** POST /google-drive/disconnect — clear tokens, creds secret, folder (admin). */
router.post("/google-drive/disconnect", requireAuth, requireAdmin("googleDrive"), async (_req, res): Promise<void> => {
  await ensureConnectionRow();
  const [row] = await db
    .update(googleDriveConnectionTable)
    .set({ refreshTokenEnc: null, accountEmail: null, folderId: null, folderName: null })
    .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID))
    .returning();
  res.json(connectionInfo(row));
});

/**
 * POST /google-drive/upload — upload a file into the managed folder. The file is
 * sent as the raw request body (Content-Type = file type, X-File-Name header
 * carries the URL-encoded name) to avoid a multipart parser dependency. The
 * server holds the Drive credentials; the client never sees a token. Returns the
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
      const accessToken = await getAccessToken(conn);
      const file = await uploadToFolder(accessToken, conn.folderId, name, contentType, body);
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
    .select({ entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(sql`${entityRecordsTable.valuesJson}::text LIKE ${"%" + fileId + "%"}`);
  if (candidates.length === 0) return false;

  const perms = await getPermissions(req);
  const roleId = req.user.roleId;
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
    if (resolveFieldAccess(holder, perms, roleId, rec.entityId) === "hidden") continue;
    const { scope, scopeFieldKeys } = effectiveScope(perms, rec.entityId);
    if (scope === "own" && !recordOwnedBy(values, scopeFieldKeys, userId)) continue;
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

export default router;
