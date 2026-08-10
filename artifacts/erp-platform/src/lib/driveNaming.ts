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
  | { kind: "hash" }
  | { kind: "date" }
  /** Uploader's email local part (before "@") — always Latin, unlike names. */
  | { kind: "user" };

const HASH_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Random short id for the "hash" section (7 chars, unambiguous alphanumerics). */
export function driveNameHash(length = 7): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += HASH_ALPHABET[b % HASH_ALPHABET.length];
  return out;
}

/**
 * Current LOCAL date+time for the "date" section, file-name-safe and sortable:
 * `2026-08-10_14-35`.
 */
export function driveNameDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}`;
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
/** File-name-safe uploader segment: email local part (before "@"). */
export function driveNameUserSegment(email: string | undefined | null): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  return sanitizeSegment(local);
}

export function composeDriveFileName(
  originalName: string,
  sections: DriveNameSection[],
  rowValues: Record<string, unknown> | undefined,
  uploaderEmail?: string | null,
): string | null {
  return composeDriveFileNameDetailed(originalName, sections, rowValues, uploaderEmail).name;
}

/**
 * Like composeDriveFileName but also reports whether some FIELD section could
 * not be resolved from the current values (used to mark uploads that should be
 * re-checked/renamed once the record is saved with its final values).
 */
export function composeDriveFileNameDetailed(
  originalName: string,
  sections: DriveNameSection[],
  rowValues: Record<string, unknown> | undefined,
  uploaderEmail?: string | null,
): { name: string | null; unresolvedFieldSection: boolean } {
  if (!sections.length) return { name: null, unresolvedFieldSection: false };
  let unresolvedFieldSection = false;
  const parts: string[] = [];
  for (const s of sections) {
    if (s.kind === "text") {
      const t = sanitizeSegment(s.text ?? "");
      if (t) parts.push(t);
    } else if (s.kind === "field") {
      const candidates = [s.fieldKey, ...(s.alts ?? []).map((a) => a.fieldKey)].filter(Boolean) as string[];
      let resolved = false;
      for (const key of candidates) {
        const seg = valueToSegment(rowValues?.[key]);
        if (seg) {
          parts.push(seg);
          resolved = true;
          break;
        }
      }
      if (!resolved) unresolvedFieldSection = true;
    } else if (s.kind === "hash") {
      parts.push(driveNameHash());
    } else if (s.kind === "date") {
      parts.push(driveNameDate());
    } else if (s.kind === "user") {
      const seg = driveNameUserSegment(uploaderEmail);
      if (seg) parts.push(seg);
    }
  }
  if (!parts.length) return { name: null, unresolvedFieldSection };
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot) : "";
  return { name: `${parts.join("_")}${ext}`, unresolvedFieldSection };
}
