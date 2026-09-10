export type PageValuesHydrationState =
  | { status: "idle"; key: null; error: null }
  | { status: "loading"; key: string; error: null }
  | { status: "ready"; key: string; error: null }
  | { status: "error"; key: string; error: string };

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