/** Mirror-page tokens include the synthetic status column, not just field columns. */
export function orderMirrorColumns<T extends {
  token: string;
  kind: "entity" | "page" | "status";
  field?: { sortOrder: number };
}>(base: T[], saved: string[], statusSortOrder: number): T[] {
  const idx = new Map(saved.map((token, i) => [token, i]));
  // Old saved page orders didn't contain the status token. Keep their historical
  // entity-sortOrder placement until the admin explicitly moves a column.
  const legacyStatus = !idx.has("__status__") ? base.find(c => c.kind === "status") : undefined;
  const sorted = base
    .filter(c => c !== legacyStatus)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ia = idx.get(a.c.token) ?? Number.MAX_SAFE_INTEGER;
      const ib = idx.get(b.c.token) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib || a.i - b.i;
    })
    .map(({ c }) => c);
  if (legacyStatus) {
    const insertAt = sorted.findIndex(c => c.kind === "entity" && (c.field?.sortOrder ?? 0) > statusSortOrder);
    sorted.splice(insertAt < 0 ? sorted.length : insertAt, 0, legacyStatus);
  }
  return sorted;
}

export function moveMirrorColumn<T extends { token: string }>(columns: T[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= columns.length) return columns.map(c => c.token);
  const next = [...columns];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map(c => c.token);
}