import { useEffect, useRef } from "react";

type RefreshTask = () => void | Promise<unknown>;

const listeners = new Set<RefreshTask>();
let refreshInFlight: Promise<void> | null = null;

/** Registers a refresh task outside React (also useful for focused tests). */
export function registerManualDataRefresh(task: RefreshTask): () => void {
  let active = true;
  // A refresh snapshots listeners before its promise callbacks run. Keep this
  // guard inside the listener so an unmounted component cannot be called from
  // such an already-captured snapshot.
  const listener: RefreshTask = () => (active ? task() : undefined);
  listeners.add(listener);
  return () => {
    active = false;
    listeners.delete(listener);
  };
}

/**
 * Registers a non-query data path (for example an API mutation used as a read)
 * with the global refresh control.
 */
export function useManualDataRefresh(task: RefreshTask): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    return registerManualDataRefresh(() => taskRef.current());
  }, []);
}

/** Runs every mounted non-query refresh path and waits for them to settle. */
export function refreshManualDataPaths(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  const inFlight = Promise.allSettled(
    [...listeners].map((listener) => Promise.resolve().then(listener)),
  ).then(() => undefined);
  refreshInFlight = inFlight;
  void inFlight.then(() => {
    if (refreshInFlight === inFlight) refreshInFlight = null;
  });
  return inFlight;
}