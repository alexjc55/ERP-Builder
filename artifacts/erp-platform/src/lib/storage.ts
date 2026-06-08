import { requestUploadUrl } from "@workspace/api-client-react";

/** A source a `file`-type field value may come from. */
export type FileSource = "server" | "gdrive" | "link";

/** Server upload (object storage). Legacy values omit `kind` but have a path. */
export interface ServerFileValue {
  kind?: "server";
  path: string;
  name: string;
  contentType?: string;
  size?: number;
}

/** A file managed in Google Drive (uploaded through our server). */
export interface GDriveFileValue {
  kind: "gdrive";
  fileId: string;
  name: string;
  contentType?: string;
  size?: number;
  webViewLink?: string;
}

/** An external link pasted by the user. */
export interface LinkFileValue {
  kind: "link";
  url: string;
  name?: string;
}

/** Stored value shape for a `file`-type field (polymorphic by source). */
export type FileValue = ServerFileValue | GDriveFileValue | LinkFileValue;

/** Resolve the source of a stored file value (legacy = server). */
export function fileValueKind(value: FileValue): FileSource {
  const k = (value as { kind?: string }).kind;
  if (k === "gdrive" || k === "link") return k;
  return "server";
}

export function isServerFile(value: FileValue): value is ServerFileValue {
  return fileValueKind(value) === "server";
}
export function isGDriveFile(value: FileValue): value is GDriveFileValue {
  return fileValueKind(value) === "gdrive";
}
export function isLinkFile(value: FileValue): value is LinkFileValue {
  return fileValueKind(value) === "link";
}

export function isFileValue(value: unknown): value is FileValue {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (o.kind === "link") return typeof o.url === "string";
  if (o.kind === "gdrive") return typeof o.fileId === "string" && typeof o.name === "string";
  // server or legacy (no kind)
  return typeof o.path === "string" && typeof o.name === "string";
}

/** Display name for any file value (links may omit a name → fall back to URL). */
export function fileValueName(value: FileValue): string {
  if (isLinkFile(value)) return value.name && value.name.trim() ? value.name : value.url;
  return value.name;
}

/**
 * Resolve which file sources a field offers. Mirrors the server default: an
 * empty/unset config means server upload only (legacy behavior).
 */
export function fileAllowedSources(
  config: { allowedSources?: FileSource[] } | null | undefined,
): FileSource[] {
  const list = config?.allowedSources;
  return Array.isArray(list) && list.length > 0 ? list : ["server"];
}

/**
 * Upload a file via the presigned-URL flow:
 * 1. ask the API for a presigned URL (auth attached by the generated client),
 * 2. PUT the bytes directly to that URL.
 * Returns the normalized object path to store in a record.
 */
export async function uploadFile(
  file: File,
): Promise<{ path: string; contentType: string; size: number }> {
  const contentType = file.type || "application/octet-stream";
  const res = await requestUploadUrl({ name: file.name, size: file.size, contentType });
  const put = await fetch(res.uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  });
  if (!put.ok) {
    throw new Error(`Upload failed (${put.status})`);
  }
  return { path: res.objectPath, contentType, size: file.size };
}

/** Result of uploading a file into the managed Google Drive folder. */
export interface GDriveUploadResult {
  fileId: string;
  name: string;
  contentType?: string;
  size?: number;
  webViewLink?: string;
}

/**
 * Upload a file into the configured Google Drive folder via our server (which
 * holds the Drive credentials — they are never exposed to the client). Returns
 * the created Drive file's metadata to store as a `gdrive` file value.
 */
export async function uploadToGoogleDrive(file: File): Promise<GDriveUploadResult> {
  const token = localStorage.getItem("erp_token");
  const headers: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
    "X-File-Name": encodeURIComponent(file.name),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch("/api/google-drive/upload", {
    method: "POST",
    headers,
    body: file,
  });
  if (!resp.ok) {
    throw new Error(`Drive upload failed (${resp.status})`);
  }
  return (await resp.json()) as GDriveUploadResult;
}

/** API serving URL for a stored object path (e.g. `/objects/uploads/uuid`). */
export function objectServingUrl(path: string): string {
  return `/api/storage${path}`;
}

/** API serving URL for a managed Google Drive file's content (auth-gated proxy). */
export function gdriveContentUrl(fileId: string): string {
  return `/api/google-drive/files/${encodeURIComponent(fileId)}/content`;
}

/**
 * Fetch an auth-gated URL as a blob object URL using the stored bearer token.
 * `<img>`/`<iframe>` can't carry the Authorization header, so we fetch the bytes
 * and hand back a blob URL. The caller must revoke it.
 */
async function fetchAuthedBlobUrl(url: string): Promise<string> {
  const token = localStorage.getItem("erp_token");
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    throw new Error(`Failed to load (${resp.status})`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

/** Fetch a managed Google Drive file's content as a blob object URL. */
export function fetchGDriveBlobUrl(fileId: string): Promise<string> {
  return fetchAuthedBlobUrl(gdriveContentUrl(fileId));
}

/** Open a managed Google Drive file (proxied bytes) in a new browser tab. */
export async function openGDriveInNewTab(fileId: string): Promise<void> {
  const url = await fetchGDriveBlobUrl(fileId);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Fetch an auth-gated object as a blob object URL. Object serving requires a
 * Bearer token, which `<img src>` / `<iframe src>` cannot carry, so we fetch the
 * bytes and hand back a blob URL. The caller is responsible for revoking it.
 */
export function fetchObjectBlobUrl(path: string): Promise<string> {
  return fetchAuthedBlobUrl(objectServingUrl(path));
}

/** Fetch an auth-gated object and open it in a new browser tab. */
export async function openObjectInNewTab(path: string): Promise<void> {
  const url = await fetchObjectBlobUrl(path);
  window.open(url, "_blank", "noopener");
  // Give the new tab time to load before reclaiming the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Download a trashed (recycle-bin) file by its deleted-files row id. The bytes
 * are served behind an auth + superAdmin gate, so we fetch with the bearer token
 * and trigger a browser download under the original file name.
 */
export async function downloadTrashedFile(id: number, fileName: string): Promise<void> {
  const url = await fetchAuthedBlobUrl(`/api/deleted-files/${id}/content`);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `file-${id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PreviewKind = "image" | "pdf" | "other";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i;
const PDF_EXT = /\.pdf(\?|#|$)/i;

/** Decide how to preview a stored file based on its content type / name. */
export function contentTypeKind(contentType?: string, name?: string): PreviewKind {
  if (contentType?.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (name && IMAGE_EXT.test(name)) return "image";
  if (name && PDF_EXT.test(name)) return "pdf";
  return "other";
}

export type UrlPreview =
  | { kind: "image" | "pdf"; src: string }
  | { kind: "gdrive"; src: string }
  | { kind: null; src: string };

/**
 * Detect whether a URL points to something previewable: a Google Drive file
 * (rewritten to its embeddable `/preview` URL), or a direct image / PDF link.
 */
export function detectUrlPreview(url: string): UrlPreview {
  if (/drive\.google\.com/i.test(url)) {
    const byPath = url.match(/\/file\/d\/([^/]+)/);
    const byQuery = url.match(/[?&]id=([^&]+)/);
    const id = byPath?.[1] ?? byQuery?.[1];
    if (id) {
      return { kind: "gdrive", src: `https://drive.google.com/file/d/${id}/preview` };
    }
  }
  if (IMAGE_EXT.test(url)) return { kind: "image", src: url };
  if (PDF_EXT.test(url)) return { kind: "pdf", src: url };
  return { kind: null, src: url };
}
