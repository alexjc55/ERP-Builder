export type InlineCommitAttempt = "accepted" | "rejected" | "already-committed";

/**
 * Calls an inline-save callback at most once after it accepts a value. A false
 * acknowledgement is intentionally retryable: page-local hydration may reject
 * a save until its authoritative CAS version has arrived.
 */
export function attemptInlineCommit<T>(
  committedRef: { current: boolean },
  onCommit: (raw: T) => boolean | void,
  raw: T,
): InlineCommitAttempt {
  if (committedRef.current) return "already-committed";
  if (onCommit(raw) === false) return "rejected";
  committedRef.current = true;
  return "accepted";
}