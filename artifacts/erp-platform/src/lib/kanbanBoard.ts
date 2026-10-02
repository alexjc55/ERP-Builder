// Pure Kanban board helpers (no React / API imports so node:test can load them).

export type KanbanLaneKey = string; // "s:<statusId>" | "null"
export const NULL_LANE: KanbanLaneKey = "null";

export const laneKeyFor = (statusId: number | null | undefined): KanbanLaneKey =>
  statusId == null ? NULL_LANE : `s:${statusId}`;

export const statusIdForLane = (key: KanbanLaneKey): number | null =>
  key === NULL_LANE ? null : Number(key.slice(2));

export type KanbanStatusLike = {
  id: number;
  sortOrder: number;
  isActive?: boolean;
  hideByDefault?: boolean;
};

export type KanbanBaseQueryLike = {
  statusIds?: number[];
  excludeStatusIds?: number[];
  showHiddenStatuses?: boolean;
  statusIsNull?: boolean;
  [k: string]: unknown;
};

/**
 * Which lanes the board shows. Lanes never widen the caller's selection:
 * an explicit statusIds selection intersects (and excludes the null lane),
 * soft excludeStatusIds drop lanes, and hideByDefault statuses stay hidden
 * unless the query opted in via showHiddenStatuses.
 */
export function computeLanes(
  statuses: readonly KanbanStatusLike[],
  base: KanbanBaseQueryLike,
): KanbanLaneKey[] {
  const selected = base.statusIds && base.statusIds.length > 0 ? new Set(base.statusIds) : null;
  const excluded = new Set(base.excludeStatusIds ?? []);
  const out: KanbanLaneKey[] = [];
  // statusIsNull AND-combines with statusIds: never widen an explicit selection.
  if (base.statusIsNull === true) return selected ? [] : [NULL_LANE];
  // Null-status records stay readable (legacy rows) regardless of allowNoStatus.
  if (!selected) out.push(NULL_LANE);
  const sorted = [...statuses].filter((s) => s.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const s of sorted) {
    if (selected && !selected.has(s.id)) continue;
    if (excluded.has(s.id)) continue;
    if (s.hideByDefault && !base.showHiddenStatuses) continue;
    out.push(laneKeyFor(s.id));
  }
  return out;
}

/** Builds the records/query body for one lane from the complete base snapshot. */
export function buildLaneQuery<T extends KanbanBaseQueryLike>(
  base: T,
  lane: KanbanLaneKey,
  page: number,
  pageSize: number,
): T & { page: number; pageSize: number } {
  const statusId = statusIdForLane(lane);
  const q: T & { page: number; pageSize: number } = { ...base, page, pageSize };
  if (statusId == null) {
    delete q.statusIds;
    q.statusIsNull = true;
  } else {
    q.statusIds = [statusId];
    delete q.statusIsNull;
  }
  return q;
}

export type MovableRecord = { id: number; statusId: number | null };
export type PendingMove<R extends MovableRecord> = { from: KanbanLaneKey; to: KanbanLaneKey; record: R };

/**
 * Overlays in-flight optimistic moves onto freshly fetched lane rows so a
 * refetch that raced a move can't resurrect the card in its old lane or drop
 * it from the destination.
 */
export function applyPendingMoves<R extends MovableRecord>(
  lane: KanbanLaneKey,
  rows: readonly R[],
  pending: ReadonlyMap<number, PendingMove<R>>,
): R[] {
  const out = rows.filter((r) => {
    const p = pending.get(r.id);
    return !p || p.to === lane;
  });
  for (const p of pending.values()) {
    if (p.to === lane && !out.some((r) => r.id === p.record.id)) out.unshift(p.record);
  }
  return out;
}

/** Moves a record between lane arrays immutably; returns the source index for rollback. */
export function moveBetween<R extends MovableRecord>(
  lanes: ReadonlyMap<KanbanLaneKey, readonly R[]>,
  recordId: number,
  from: KanbanLaneKey,
  to: KanbanLaneKey,
  next: R,
): { lanes: Map<KanbanLaneKey, R[]>; index: number } {
  const m = new Map<KanbanLaneKey, R[]>();
  for (const [k, v] of lanes) m.set(k, [...v]);
  const src = m.get(from) ?? [];
  const index = src.findIndex((r) => r.id === recordId);
  if (index >= 0) src.splice(index, 1);
  m.set(from, src);
  const dst = (m.get(to) ?? []).filter((r) => r.id !== recordId);
  dst.unshift(next);
  m.set(to, dst);
  return { lanes: m, index };
}

export function isEmptyValue(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export const STATUS_FIELD_REF = "__status__";

/** Viewport-fitted board height: from the board's current top to the viewport bottom. */
export function fitBoardHeight(top: number, viewportHeight: number, min = 160, gap = 12): number {
  return Math.max(min, Math.floor(viewportHeight - Math.max(0, top) - gap));
}

export const PAGE_FIELD_PREFIX = "page:";
export const isPageFieldRef = (k: string) => k.startsWith(PAGE_FIELD_PREFIX);
export const pageFieldKeyOf = (k: string) => k.slice(PAGE_FIELD_PREFIX.length);
