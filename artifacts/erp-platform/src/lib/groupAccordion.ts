/** In expand-all mode, headers are independent toggles; no server query is needed. */
export function toggleCollapsedGroup(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function isGroupExpanded(expandAll: boolean, collapsed: ReadonlySet<string>, selected: string | undefined, key: string): boolean {
  return expandAll ? !collapsed.has(key) : selected === key;
}

/** Retain server totals verbatim: adding group sums breaks averages and visibility. */
export function fullFilteredGroupTotals(
  groups: readonly { sums?: Record<string, number> | null }[] | null | undefined,
  numericTotals: Record<string, number>,
  _narrowed: boolean,
): Record<string, number> | null {
  if (groups == null) return null;
  return numericTotals;
}