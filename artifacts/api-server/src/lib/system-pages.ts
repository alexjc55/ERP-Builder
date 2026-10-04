import { isDeepStrictEqual } from "node:util";

export const isAdminPath = (path: unknown): boolean =>
  typeof path === "string" && /^\/admin(?:\/|$)/.test(path.trim());

const editable = new Set(["nameJson", "descriptionJson", "icon", "sortOrder", "menuDefaultExpanded"]);

/** Clients may resend unchanged fields, but only menu presentation may change. */
export function changesSystemPage(current: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  return Object.entries(patch).some(([key, value]) =>
    !editable.has(key) && !isDeepStrictEqual(current[key], value));
}