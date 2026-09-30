import { db, statusTagsTable, tagsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

/** Display preferences do not change the underlying tag assignments. */
export async function enrichStatusTags<T extends { id: number; showTags: boolean; primaryTagId: number | null }>(
  statuses: T[],
): Promise<Array<T & { tagIds: number[]; displayTags: Array<{ id: number; nameJson: unknown; color: string }> }>> {
  if (statuses.length === 0) return [];
  const links = await db
    .select({
      statusId: statusTagsTable.statusId,
      id: tagsTable.id,
      nameJson: tagsTable.nameJson,
      color: tagsTable.color,
    })
    .from(statusTagsTable)
    .innerJoin(tagsTable, eq(statusTagsTable.tagId, tagsTable.id))
    .where(inArray(statusTagsTable.statusId, statuses.map((status) => status.id)))
    .orderBy(tagsTable.id);
  const byStatus = new Map<number, typeof links>();
  for (const link of links) {
    const group = byStatus.get(link.statusId) ?? [];
    group.push(link);
    byStatus.set(link.statusId, group);
  }
  return statuses.map((status) => {
    const assigned = byStatus.get(status.id) ?? [];
    const visible = !status.showTags ? [] : status.primaryTagId != null && assigned.some((tag) => tag.id === status.primaryTagId)
      ? assigned.filter((tag) => tag.id === status.primaryTagId) : assigned;
    return {
      ...status,
      tagIds: assigned.map((tag) => tag.id),
      displayTags: visible.map(({ id, nameJson, color }) => ({ id, nameJson, color })),
    };
  });
}