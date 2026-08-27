// Shared helpers for select-field options.
//
// A select option is a stable `value` (the key persisted on records, never
// recomputed from the label) plus a multilingual display `labelJson`. Renaming
// edits only labelJson, so the change reflects in every existing record. These
// helpers stay tolerant of legacy plain-string options (`["a","b"]`) by
// normalizing them to `{ value: "a", labelJson: { ru: "a" } }`.

type MLText = { ru?: string | null; en?: string | null; he?: string | null };
export type SelectOption = { value: string; labelJson: MLText; statusId?: number };

function cleanLabel(raw: unknown): MLText {
  const lj = (raw && typeof raw === "object" ? raw : {}) as MLText;
  const pick = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  return { ru: pick(lj.ru), en: pick(lj.en), he: pick(lj.he) };
}

function labelStrings(o: SelectOption): string[] {
  return [o.labelJson.ru, o.labelJson.en, o.labelJson.he].filter(
    (x): x is string => typeof x === "string" && x.trim() !== "",
  );
}

/** Normalize raw stored optionsJson (new or legacy shape) to SelectOption[]. */
export function normalizeOptions(raw: unknown): SelectOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectOption[] = [];
  for (const el of raw) {
    if (typeof el === "string") {
      const v = el.trim();
      if (v) out.push({ value: v, labelJson: { ru: v } });
    } else if (el && typeof el === "object") {
      const o = el as Record<string, unknown>;
      const value = typeof o.value === "string" ? o.value.trim() : "";
      if (!value) continue;
      const statusId =
        typeof o.statusId === "number" && Number.isInteger(o.statusId) && o.statusId > 0
          ? o.statusId
          : undefined;
      out.push({ value, labelJson: cleanLabel(o.labelJson), ...(statusId ? { statusId } : {}) });
    }
  }
  return out;
}

/** Set of valid stored values for a select field. */
export function optionValues(raw: unknown): Set<string> {
  return new Set(normalizeOptions(raw).map((o) => o.value));
}

/**
 * Set of the NUMERIC values of options (for percent list-mode). Options are
 * compared by numeric equivalence, not string, so "12.50"/"001" match 12.5/1.
 * Non-numeric option values are dropped.
 */
export function optionNumbers(raw: unknown): Set<number> {
  const out = new Set<number>();
  for (const o of normalizeOptions(raw)) {
    const n = Number(o.value);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

/** Best human-readable labels (ru→en→he, fallback to value) — for error messages. */
export function optionLabels(raw: unknown): string[] {
  return normalizeOptions(raw).map((o) => o.labelJson.ru || o.labelJson.en || o.labelJson.he || o.value);
}

const norm = (s: string) => s.trim().toLowerCase();

/** Resolve an incoming string (import) to an option by value or any label. */
export function matchOption(raw: unknown, input: string): SelectOption | undefined {
  const opts = normalizeOptions(raw);
  const s = input.trim();
  const ns = norm(s);
  return (
    opts.find((o) => o.value === s) ??
    opts.find((o) => labelStrings(o).some((l) => l === s)) ??
    opts.find((o) => norm(o.value) === ns || labelStrings(o).some((l) => norm(l) === ns))
  );
}

/**
 * Sanitize admin-supplied options before persisting (create/update):
 * normalize shape, drop fully-empty rows, ensure each has ≥1 label (fallback to
 * value), preserve existing values (rename-safe), and dedupe/derive values for
 * new rows. A value is NEVER recomputed from an edited label.
 */
export function sanitizeOptionsInput(raw: unknown): SelectOption[] {
  const used = new Set<string>();
  const out: SelectOption[] = [];
  if (!Array.isArray(raw)) return out;
  for (const el of raw) {
    let value = "";
    let labelJson: MLText = {};
    let statusId: number | undefined;
    if (typeof el === "string") {
      value = el.trim();
      labelJson = { ru: el.trim() };
    } else if (el && typeof el === "object") {
      const o = el as Record<string, unknown>;
      value = typeof o.value === "string" ? o.value.trim() : "";
      labelJson = cleanLabel(o.labelJson);
      statusId =
        typeof o.statusId === "number" && Number.isInteger(o.statusId) && o.statusId > 0
          ? o.statusId
          : undefined;
    } else {
      continue;
    }
    const anyLabel = labelJson.ru || labelJson.en || labelJson.he;
    if (!value && !anyLabel) continue;
    if (!value) value = anyLabel as string;
    if (!anyLabel) labelJson = { ru: value };
    let v = value;
    let n = 2;
    while (used.has(v)) v = `${value}_${n++}`;
    used.add(v);
    out.push({ value: v, labelJson, ...(statusId ? { statusId } : {}) });
  }
  return out;
}

type SelectFieldLike = {
  fieldKey: string;
  fieldType: string;
  optionsJson: unknown;
};

export type MappedStatusResult =
  | { statusId?: number; fieldKeys: string[] }
  | { error: string; fieldKeys: string[] };

/**
 * Resolve status bindings only for select values that actually changed.
 * Multiple changed fields may point at the same status; different targets are
 * rejected rather than depending on field ordering.
 */
export function mappedStatusForChangedValues(
  fields: SelectFieldLike[],
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): MappedStatusResult {
  const byStatus = new Map<number, string[]>();
  for (const field of fields) {
    if (field.fieldType !== "select") continue;
    const previous = before?.[field.fieldKey];
    const next = after[field.fieldKey];
    if (before && JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) continue;
    if (typeof next !== "string") continue;
    const option = normalizeOptions(field.optionsJson).find((candidate) => candidate.value === next);
    if (!option?.statusId) continue;
    const keys = byStatus.get(option.statusId) ?? [];
    keys.push(field.fieldKey);
    byStatus.set(option.statusId, keys);
  }
  const fieldKeys = [...byStatus.values()].flat();
  if (byStatus.size > 1) {
    return {
      error: `Changed select fields require different system statuses: ${fieldKeys.join(", ")}`,
      fieldKeys,
    };
  }
  const [statusId] = byStatus.keys();
  return { ...(statusId ? { statusId } : {}), fieldKeys };
}
