import { createReadStream, promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Response } from "express";

/**
 * Root directory on disk where locally-stored uploads live. Defaults to an
 * `uploads/` folder in the process working directory (workflows run from the
 * repo root), overridable with the `UPLOADS_DIR` env var. Everything served or
 * written by this module is confined to this root (see `resolveDiskPath`).
 *
 * Layout:
 *   uploads/branding/<uuid>__<name>          branding logo/assets (git-tracked)
 *   uploads/files/<storageDir>/<uuid>__<name> file-field record data (gitignored)
 */
export const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));

/** URL/stored-path prefix for local files. Maps to `${UPLOADS_ROOT}/<rel>`. */
export const LOCAL_PREFIX = "/local/";

/** Thrown when a local path is malformed, escapes the root, or is missing. */
export class LocalObjectNotFoundError extends Error {
  constructor(message = "Local object not found") {
    super(message);
    this.name = "LocalObjectNotFoundError";
    Object.setPrototypeOf(this, LocalObjectNotFoundError.prototype);
  }
}

/** True if a stored path refers to a local-disk file (`/local/...`). */
export function isLocalPath(p: unknown): p is string {
  return typeof p === "string" && p.startsWith(LOCAL_PREFIX);
}

/**
 * Resolve a stored `/local/...` path to an absolute on-disk path, guarding
 * against traversal: the result must stay inside `UPLOADS_ROOT`. Throws
 * `LocalObjectNotFoundError` on any malformed or escaping path.
 */
function resolveDiskPath(storedPath: string): string {
  if (!isLocalPath(storedPath)) throw new LocalObjectNotFoundError();
  const rel = storedPath.slice(LOCAL_PREFIX.length);
  if (!rel || rel.includes("\0")) throw new LocalObjectNotFoundError();
  const full = path.resolve(UPLOADS_ROOT, rel);
  const rootWithSep = UPLOADS_ROOT.endsWith(path.sep) ? UPLOADS_ROOT : UPLOADS_ROOT + path.sep;
  if (full !== UPLOADS_ROOT && !full.startsWith(rootWithSep)) throw new LocalObjectNotFoundError();
  return full;
}

/** Sanitize an uploaded file name to a safe basename (no path parts). */
function sanitizeName(name: string): string {
  const base = path
    .basename(name || "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+/, "")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return base || "file";
}

/**
 * Persist bytes under `<subdir>/<uuid>__<safeName>` and return the stored path
 * (`/local/<subdir>/<uuid>__<safeName>`) plus normalized metadata. `subdir` is a
 * caller-controlled prefix (e.g. `branding` or `files/<storageDir>`), never user
 * input, so it is safe to join.
 */
export async function saveLocalFile(
  subdir: string,
  originalName: string,
  contentType: string,
  data: Buffer,
): Promise<{ path: string; name: string; contentType: string; size: number }> {
  const safe = sanitizeName(originalName);
  const rel = path.posix.join(subdir, `${randomUUID()}__${safe}`);
  const disk = resolveDiskPath(LOCAL_PREFIX + rel);
  await fs.mkdir(path.dirname(disk), { recursive: true });
  await fs.writeFile(disk, data);
  return {
    path: LOCAL_PREFIX + rel,
    name: safe,
    contentType: contentType || "application/octet-stream",
    size: data.length,
  };
}

/** Ensure a folder's on-disk directory exists under uploads/files/. */
export async function ensureLocalFolderDir(storageDir: string): Promise<void> {
  const disk = resolveDiskPath(`${LOCAL_PREFIX}files/${storageDir}`);
  await fs.mkdir(disk, { recursive: true });
}

/**
 * Stream a local file to the response, setting content headers. Returns false
 * (without touching the response) when the file is missing so the caller can
 * emit a 404. `contentType` is the stored value's content type when known;
 * otherwise it is inferred from the file extension.
 */
export async function streamLocalFile(
  res: Response,
  storedPath: string,
  opts: { contentType?: string | null; cacheControl?: string } = {},
): Promise<boolean> {
  let disk: string;
  try {
    disk = resolveDiskPath(storedPath);
  } catch {
    return false;
  }
  let stat;
  try {
    stat = await fs.stat(disk);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.setHeader("Content-Type", opts.contentType || guessContentType(storedPath));
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", opts.cacheControl || "private, max-age=3600");
  createReadStream(disk).pipe(res);
  return true;
}

/** Delete a local file, ignoring a missing file (best-effort). */
export async function deleteLocalFile(storedPath: string): Promise<void> {
  let disk: string;
  try {
    disk = resolveDiskPath(storedPath);
  } catch {
    return;
  }
  try {
    await fs.unlink(disk);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

/** Best-effort content type from a file name/path extension. */
export function guessContentType(nameOrPath: string): string {
  const ext = nameOrPath.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}
