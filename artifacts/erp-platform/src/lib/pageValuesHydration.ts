export type PageValuesHydrationState =
  | { status: "idle"; key: null; error: null }
  | { status: "loading"; key: string; error: null }
  | { status: "ready"; key: string; error: null }
  | { status: "error"; key: string; error: string };

/**
 * A projection request can be in flight while its previous successful snapshot
 * is still the only authoritative value that can safely be shown.  Keep this
 * distinction out of the write guard: a refreshing/stale projection is visible
 * but is never writable until the replacement has won.
 */
export type ProjectionSnapshotState = "missing" | "refreshing" | "ready" | "stale";

export function projectionSnapshotState(
  snapshotKey: string | null,
  currentKey: string | null,
  requestPending: boolean,
  requestFailed: boolean,
): ProjectionSnapshotState {
  const hasSnapshot = snapshotKey != null && snapshotKey === currentKey;
  if (!hasSnapshot) return "missing";
  if (requestFailed) return "stale";
  if (requestPending) return "refreshing";
  return "ready";
}

export const idlePageValuesHydration = (): PageValuesHydrationState => ({
  status: "idle",
  key: null,
  error: null,
});

export function pageValuesHydrationKey(pageId: number, recordIds: readonly number[]): string {
  return `${pageId}:${recordIds.join(",")}`;
}

export function canWritePageValues(
  state: PageValuesHydrationState,
  currentKey: string | null,
): boolean {
  return currentKey != null && state.status === "ready" && state.key === currentKey;
}

export function runPageValueWrite(
  state: PageValuesHydrationState,
  currentKey: string | null,
  write: () => void,
): boolean {
  if (!canWritePageValues(state, currentKey)) return false;
  write();
  return true;
}