export type StatusTag = {
  id: number;
  nameJson: Record<string, string> | null;
  color?: string | null;
  sortOrder?: number | null;
  applicableTo?: string[] | null;
};

export type TaggedStatus = {
  id: number;
  tagIds?: number[] | null;
};

/**
 * A tag is applicable to an entity when at least one of that entity's statuses
 * carries it. Selected IDs are retained even while status metadata is loading
 * (or after a tag was removed) so editing never silently widens a restriction.
 */
export function applicableStatusTags(
  tags: StatusTag[],
  statuses: TaggedStatus[],
  selectedIds: number[] = [],
): StatusTag[] {
  const used = new Set(statuses.flatMap((status) => status.tagIds ?? []));
  const selected = new Set(selectedIds);
  return tags
    .filter(
      (tag) =>
        (tag.applicableTo == null || tag.applicableTo.includes("statuses")) &&
        (used.has(tag.id) || selected.has(tag.id)),
    )
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

export function toggleStatusTagId(selectedIds: number[], tagId: number): number[] {
  return selectedIds.includes(tagId)
    ? selectedIds.filter((id) => id !== tagId)
    : [...selectedIds, tagId];
}