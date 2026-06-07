import { requestUploadUrl } from "@workspace/api-client-react";

/** Stored value shape for a `file`-type field. */
export interface FileValue {
  path: string;
  name: string;
  contentType?: string;
  size?: number;
}

export function isFileValue(value: unknown): value is FileValue {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).path === "string" &&
    typeof (value as Record<string, unknown>).name === "string"
  );
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

/** API serving URL for a stored object path (e.g. `/objects/uploads/uuid`). */
export function objectServingUrl(path: string): string {
  return `/api/storage${path}`;
}

/**
 * Fetch an auth-gated object as a blob object URL. Object serving requires a
 * Bearer token, which `<img src>` / `<iframe src>` cannot carry, so we fetch the
 * bytes and hand back a blob URL. The caller is responsible for revoking it.
 */
export async function fetchObjectBlobUrl(path: string): Promise<string> {
  const token = localStorage.getItem("erp_token");
  const resp = await fetch(objectServingUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    throw new Error(`Failed to load object (${resp.status})`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

/** Fetch an auth-gated object and open it in a new browser tab. */
export async function openObjectInNewTab(path: string): Promise<void> {
  const url = await fetchObjectBlobUrl(path);
  window.open(url, "_blank", "noopener");
  // Give the new tab time to load before reclaiming the blob.
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
