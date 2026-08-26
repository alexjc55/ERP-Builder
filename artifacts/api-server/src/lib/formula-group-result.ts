export type FormulaGroupReference =
  | { scope: "entity"; fieldKey: string }
  | { scope: "page"; pageId: number; fieldKey: string };

export type FormulaGroupConfig = {
  key: string;
  fields: readonly FormulaGroupReference[];
};

export type FormulaGroupRow = {
  id: number;
  createdAt: Date | string;
  entityValues: Readonly<Record<string, unknown>>;
  pageValues?: ReadonlyMap<number, Readonly<Record<string, unknown>>>;
};

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (Object.is(value, -0)) return "number:0";
  }
  if (value === null || typeof value !== "object") return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `array:[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `object:{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function earlier(a: FormulaGroupRow, b: FormulaGroupRow): boolean {
  const at = a.createdAt instanceof Date ? a.createdAt.getTime() : Date.parse(a.createdAt);
  const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : Date.parse(b.createdAt);
  const safeA = Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
  const safeB = Number.isFinite(bt) ? bt : Number.POSITIVE_INFINITY;
  return safeA < safeB || (safeA === safeB && a.id < b.id);
}

function isEmptyGroupValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Returns the record ids allowed to retain each formula result. Empty tuples
 * intentionally make every record a winner. Input order never affects winners.
 */
export function formulaGroupResultWinners(
  rows: readonly FormulaGroupRow[],
  configs: readonly FormulaGroupConfig[],
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const config of configs) {
    if (config.fields.length === 0) {
      result.set(config.key, new Set(rows.map((row) => row.id)));
      continue;
    }
    const byTuple = new Map<string, FormulaGroupRow>();
    const winners = new Set<number>();
    for (const row of rows) {
      const tuple = config.fields.map((ref) =>
        ref.scope === "entity"
          ? row.entityValues[ref.fieldKey]
          : row.pageValues?.get(ref.pageId)?.[ref.fieldKey],
      );
      // A completely empty key identifies no real business group. Treat the
      // record as its own group so unrelated blank rows never suppress each
      // other's formula result.
      if (tuple.every(isEmptyGroupValue)) {
        winners.add(row.id);
        continue;
      }
      const key = canonical(tuple);
      const winner = byTuple.get(key);
      if (!winner || earlier(row, winner)) byTuple.set(key, row);
    }
    for (const row of byTuple.values()) winners.add(row.id);
    result.set(config.key, winners);
  }
  return result;
}

/** Replaces grouped formula values with numeric zero on non-winning rows. */
export function applyFormulaGroupResults(
  values: ReadonlyMap<number, Record<string, unknown>>,
  winners: ReadonlyMap<string, ReadonlySet<number>>,
): Map<number, Record<string, unknown>> {
  const out = new Map<number, Record<string, unknown>>();
  for (const [id, rowValues] of values) {
    const next = { ...rowValues };
    for (const [key, ids] of winners) if (!ids.has(id)) next[key] = 0;
    out.set(id, next);
  }
  return out;
}