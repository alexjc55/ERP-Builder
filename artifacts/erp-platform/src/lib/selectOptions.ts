// Shared client helpers for select-field options.
//
// An option is a stable `value` (stored on records, never recomputed from the
// label) plus a multilingual `labelJson`. Helpers stay tolerant of legacy
// plain-string options by normalizing them to `{ value, labelJson: { ru } }`.

import type { MultilingualText, SelectOption } from "@workspace/api-client-react";

export type { SelectOption };

/** Normalize raw optionsJson (new or legacy shape) to SelectOption[]. */
export function normalizeSelectOptions(raw: unknown): SelectOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectOption[] = [];
  for (const el of raw) {
    if (typeof el === "string") {
      const v = el.trim();
      if (v) out.push({ value: v, labelJson: { ru: v } });
    } else if (el && typeof el === "object" && typeof (el as { value?: unknown }).value === "string") {
      const o = el as { value: string; labelJson?: MultilingualText };
      const value = o.value.trim();
      if (value) out.push({ value, labelJson: o.labelJson ?? {} });
    }
  }
  return out;
}

/** Display label for a stored value (ru→en→he via ml), fallback to the value. */
export function getOptionLabel(
  raw: unknown,
  value: string,
  ml: (v: MultilingualText | string | undefined | null) => string,
): string {
  const found = normalizeSelectOptions(raw).find((o) => o.value === value);
  if (!found) return value;
  return ml(found.labelJson) || value;
}
