import type { ScopeFilter } from "@workspace/db";

/**
 * The "filter" row scope is enforced by the SAME machinery as the "own" scope
 * (ownScopeWhere / isRecordOwned in routes/own-scope.ts), so every existing
 * enforcement site — records list/query/filter-values/pivot/calendar, single
 * record GET/update/delete/archive/bulk, page record-values/related-values/
 * related-candidates, storage/audit/google-drive file checks — automatically
 * applies it with no per-site changes. To do that, effectiveScope/
 * effectiveScopeFor ENCODE each value-filter condition as a synthetic
 * "owner field key" carried inside scopeFieldKeys. own-scope.ts decodes them
 * back into value conditions. The encoded form never leaves the server:
 * merged permissions returned to the client keep the structured
 * `scopeFilters` array; encoding happens only at boundary-resolution time.
 */
const PREFIX = "__valfilter__:";

export const encodeScopeFilter = (f: ScopeFilter): string =>
  PREFIX + JSON.stringify({ k: f.fieldKey, v: f.values, ...(f.pageId != null ? { p: f.pageId } : {}) });

export const encodeScopeFilters = (filters: ScopeFilter[] | undefined): string[] =>
  (filters ?? [])
    .filter((f) => f && typeof f.fieldKey === "string" && f.fieldKey.length > 0 && Array.isArray(f.values))
    .map(encodeScopeFilter);

/** Decode a scopeFieldKeys entry; null when it is a plain owner-field key. */
export function decodeScopeFilter(key: string): ScopeFilter | null {
  if (!key.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(key.slice(PREFIX.length)) as { k?: unknown; v?: unknown; p?: unknown };
    if (typeof parsed.k !== "string" || !Array.isArray(parsed.v)) return null;
    return {
      fieldKey: parsed.k,
      values: parsed.v.map((x) => String(x)),
      ...(typeof parsed.p === "number" && Number.isInteger(parsed.p) ? { pageId: parsed.p } : {}),
    };
  } catch {
    return null;
  }
}
