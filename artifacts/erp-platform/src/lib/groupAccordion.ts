/** Membership is loaded for the normal page in both visual expansion modes. */
export function groupedQueryOptions(active: boolean): { grouped?: true; withRowGroups?: true } {
  return active ? { grouped: true, withRowGroups: true } : {};
}

/** Exceptions invert the default, independently for each group. */
export function toggleGroupException(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function isGroupExpanded(defaultExpanded: boolean, exceptions: ReadonlySet<string>, key: string): boolean {
  return defaultExpanded !== exceptions.has(key);
}