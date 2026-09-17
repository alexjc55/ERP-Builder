type GroupTopology = readonly { key: string | null; count: number }[] | null;

/** Aggregates are already computed by the server. Publish them ahead of row
 * projections only if this cannot move a retained row under a different group. */
export function sameAggregateTopology(
  previous: GroupTopology,
  next: GroupTopology,
  previousAssignments: Record<string, string | null>,
  nextAssignments: Record<string, string | null>,
): boolean {
  if (previous === null || next === null) return previous === next;
  if (previous.length !== next.length) return false;
  if (!previous.every((group, index) =>
    group.key === next[index].key && group.count === next[index].count,
  )) return false;
  const ids = Object.keys(previousAssignments);
  return ids.length === Object.keys(nextAssignments).length &&
    ids.every((id) => Object.hasOwn(nextAssignments, id) &&
      previousAssignments[id] === nextAssignments[id]);
}