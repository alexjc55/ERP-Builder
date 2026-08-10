/**
 * Client-side composition of Google Drive file names from a managed folder's
 * name template. A template is a list of sections (fixed text / record field
 * value / random hash) joined with "_"; the original file's extension is kept.
 * Field sections resolve against the CURRENT form draft values (entity fields
 * and page-local fields share the same value map keyed by fieldKey), so naming
 * works even before the record exists. Empty/unresolvable sections are skipped;
 * if nothing resolves, the original file name is used as-is.
 */

export type DriveNameSection =
  | { kind: "text"; text?: string }
  | {
      kind: "field";
      /** Primary candidate field key. */
      fieldKey?: string;
      label?: string;
      /** Fallback candidates (same logical field under other entities/pages); first non-empty value wins. */
      alts?: { fieldKey: string; label?: string }[];
    }
  | { kind: "hash" };

const HASH_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Random short id for the "hash" section (7 chars, unambiguous alphanumerics). */
export function driveNameHash(length = 7): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += HASH_ALPHABET[b % HASH_ALPHABET.length];
  return out;
}

/** Strip characters that are unsafe/ugly in file names; collapse whitespace. */
function sanitizeSegment(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort string form of a record value for use inside a file name. */
function valueToSegment(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return sanitizeSegment(String(v));
  return ""; // objects/arrays (files, links…) have no sensible name form
}

/**
 * Build the upload file name from template sections + form draft values.
 * Returns null when the template yields nothing (caller keeps the original name).
 */
export function composeDriveFileName(
  originalName: string,
  sections: DriveNameSection[],
  rowValues: Record<string, unknown> | undefined,
): string | null {
  if (!sections.length) return null;
  const parts: string[] = [];
  for (const s of sections) {
    if (s.kind === "text") {
      const t = sanitizeSegment(s.text ?? "");
      if (t) parts.push(t);
    } else if (s.kind === "field") {
      const candidates = [s.fieldKey, ...(s.alts ?? []).map((a) => a.fieldKey)].filter(Boolean) as string[];
      for (const key of candidates) {
        const seg = valueToSegment(rowValues?.[key]);
        if (seg) {
          parts.push(seg);
          break;
        }
      }
    } else if (s.kind === "hash") {
      parts.push(driveNameHash());
    }
  }
  if (!parts.length) return null;
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot) : "";
  return `${parts.join("_")}${ext}`;
}
