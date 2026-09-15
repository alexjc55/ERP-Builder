type IntervalHandle = ReturnType<typeof setInterval>;

export interface TtlCacheScheduler {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

const systemScheduler: TtlCacheScheduler = {
  now: () => Date.now(),
  setInterval,
  clearInterval,
};

type CacheEntry<V> = { value: V; createdAt: number };

/**
 * A fixed-expiry, bounded cache. Entries expire even when their key is never
 * requested again; capacity eviction can only cause an earlier revalidation,
 * never extend an authorization verdict.
 */
export class BoundedTtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private cleanupTimer: IntervalHandle | undefined;
  private fillGeneration = 0;

  constructor(
    private readonly options: {
      ttlMs: number;
      maxEntries: number;
      cleanupIntervalMs?: number;
      scheduler?: TtlCacheScheduler;
    },
  ) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) throw new Error("ttlMs must be positive");
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) throw new Error("maxEntries must be a positive integer");
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Capture before starting asynchronous work. A later invalidate/clear makes
   * this token stale, so an older database read cannot refill the cache.
   */
  get generation(): number {
    return this.fillGeneration;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      this.stopTimerIfEmpty();
      return undefined;
    }
    // Keep the capacity policy LRU without refreshing the security TTL.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.cleanup();
    this.entries.delete(key);
    this.entries.set(key, { value, createdAt: this.scheduler.now() });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.startTimer();
  }

  /** Store an asynchronous result only if no invalidation happened meanwhile. */
  setIfCurrent(generation: number, key: K, value: V): boolean {
    if (generation !== this.fillGeneration) return false;
    this.set(key, value);
    return true;
  }

  delete(key: K): void {
    this.entries.delete(key);
    this.stopTimerIfEmpty();
  }

  /** Invalidate a key and all database reads that were already in flight. */
  invalidate(key: K): void {
    this.fillGeneration += 1;
    this.delete(key);
  }

  clear(): void {
    this.fillGeneration += 1;
    this.entries.clear();
    this.stopTimerIfEmpty();
  }

  /** Exposed for deterministic timer callbacks and focused runtime tests. */
  cleanup(): void {
    const now = this.scheduler.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt >= this.options.ttlMs) this.entries.delete(key);
    }
    this.stopTimerIfEmpty();
  }

  private get scheduler(): TtlCacheScheduler {
    return this.options.scheduler ?? systemScheduler;
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return this.scheduler.now() - entry.createdAt >= this.options.ttlMs;
  }

  private startTimer(): void {
    if (this.cleanupTimer) return;
    const intervalMs = this.options.cleanupIntervalMs ?? this.options.ttlMs;
    this.cleanupTimer = this.scheduler.setInterval(() => this.cleanup(), intervalMs);
    this.cleanupTimer.unref?.();
  }

  private stopTimerIfEmpty(): void {
    if (this.entries.size !== 0 || !this.cleanupTimer) return;
    this.scheduler.clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }
}