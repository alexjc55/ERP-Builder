import { OAuth2Client } from "google-auth-library";
import { eq } from "drizzle-orm";
import { db, googleDriveConnectionTable, type GoogleDriveConnection } from "@workspace/db";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Google Drive integration helpers. The platform stores a single Drive
 * connection (row id = 1). Files are uploaded into one managed folder using the
 * `drive.file` scope only (the app can see/manage just the files it creates),
 * so a plain free Gmail account works without broad Drive access.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_CONNECTION_ID = 1;
export const DRIVE_FOLDER_NAME = "ERP Uploads";

export interface DriveClientCreds {
  clientId: string;
  clientSecret: string;
}

/** True if the platform ships built-in OAuth client credentials via env. */
export function builtinCredsAvailable(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

/** Absolute OAuth redirect URI (must be registered in the Google OAuth client). */
export function driveRedirectUri(): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const host = domains[0] ?? "localhost";
  return `https://${host}/api/google-drive/oauth/callback`;
}

/** Resolve the active client credentials for the connection's key mode. */
export function resolveCreds(conn: GoogleDriveConnection | undefined): DriveClientCreds | null {
  if (conn?.keyMode === "own") {
    if (conn.ownClientId && conn.ownClientSecretEnc) {
      return { clientId: conn.ownClientId, clientSecret: decryptSecret(conn.ownClientSecretEnc) };
    }
    return null;
  }
  if (builtinCredsAvailable()) {
    return { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET! };
  }
  return null;
}

export function makeOAuthClient(creds: DriveClientCreds): OAuth2Client {
  return new OAuth2Client({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: driveRedirectUri(),
  });
}

/** Fetch the single connection row (undefined if never configured). */
export async function getConnection(): Promise<GoogleDriveConnection | undefined> {
  const [row] = await db
    .select()
    .from(googleDriveConnectionTable)
    .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID));
  return row;
}

/** Build the consent URL. `state` is an opaque CSRF/return token. */
export function buildAuthUrl(creds: DriveClientCreds, state: string): string {
  const client = makeOAuthClient(creds);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
    state,
  });
}

/** Exchange an auth code for tokens. Returns the refresh token + account email. */
export async function exchangeCode(
  creds: DriveClientCreds,
  code: string,
): Promise<{ refreshToken: string; accessToken: string; email?: string }> {
  const client = makeOAuthClient(creds);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token || !tokens.access_token) {
    throw new Error("Google did not return a refresh token");
  }
  let email: string | undefined;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: creds.clientId });
    email = ticket.getPayload()?.email ?? undefined;
  }
  return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token, email };
}

/** Obtain a fresh access token from the stored refresh token. */
export async function getAccessToken(conn: GoogleDriveConnection): Promise<string> {
  const creds = resolveCreds(conn);
  if (!creds) throw new Error("Google Drive client credentials are not configured");
  if (!conn.refreshTokenEnc) throw new Error("Google Drive is not connected");
  const client = makeOAuthClient(creds);
  client.setCredentials({ refresh_token: decryptSecret(conn.refreshTokenEnc) });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to refresh Google Drive access token");
  return token;
}

/** Ensure the managed upload folder exists, returning its id. */
export async function ensureFolder(
  accessToken: string,
  existingFolderId: string | null,
): Promise<{ id: string; name: string }> {
  if (existingFolderId) {
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existingFolderId)}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (resp.ok) {
      const data = (await resp.json()) as { id: string; name: string; trashed?: boolean };
      if (!data.trashed) return { id: data.id, name: data.name };
    }
  }
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!create.ok) throw new Error(`Failed to create Drive folder (${create.status})`);
  const folder = (await create.json()) as { id: string; name: string };
  return { id: folder.id, name: folder.name };
}

export interface DriveUploadedFile {
  fileId: string;
  name: string;
  contentType?: string;
  size?: number;
  webViewLink?: string;
}

/** Upload a buffer into the managed folder via Drive multipart upload. */
export async function uploadToFolder(
  accessToken: string,
  folderId: string,
  name: string,
  contentType: string,
  data: Buffer,
): Promise<DriveUploadedFile> {
  const boundary = `erp${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, data, tail]);
  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!resp.ok) throw new Error(`Drive upload failed (${resp.status})`);
  const file = (await resp.json()) as {
    id: string;
    name: string;
    size?: string;
    mimeType?: string;
    webViewLink?: string;
  };
  return {
    fileId: file.id,
    name: file.name,
    contentType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
    webViewLink: file.webViewLink,
  };
}

/** Fetch a Drive file's binary content (for the auth-gated server proxy). */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string,
): Promise<{ status: number; body: ReadableStream<Uint8Array> | null; contentType: string | null; contentLength: string | null }> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return {
    status: resp.status,
    body: resp.body as ReadableStream<Uint8Array> | null,
    contentType: resp.headers.get("content-type"),
    contentLength: resp.headers.get("content-length"),
  };
}

/** Persist a refresh token + account email, marking the connection live. */
export async function saveConnectionTokens(refreshToken: string, email: string | undefined): Promise<void> {
  await db
    .update(googleDriveConnectionTable)
    .set({
      refreshTokenEnc: encryptSecret(refreshToken),
      ...(email ? { accountEmail: email } : {}),
    })
    .where(eq(googleDriveConnectionTable.id, DRIVE_CONNECTION_ID));
}
