---
name: API memory lifecycle
description: Retention and measurement rules for auth caches, SSE, and formula request scopes.
---

**Rule:** TTL caches must bound cardinality and evict expired entries without requiring another lookup of the same key; authorization cache fills must respect invalidation generations.

**Why:** Lazy expiration leaves abandoned keys resident indefinitely, and in-flight reads can repopulate an invalidated allow verdict after access changes.

**How to apply:** Eviction only causes revalidation, never extends permission acceptance. Keep auth mutations connected to invalidation after successful persistence.

**Rule:** Presence expiry, replaced SSE streams, slow readers, and shutdown all require explicit resource ownership and cleanup.

**Why:** Request-close cleanup alone misses inactive presence and replacement timing; ignoring response backpressure can retain outbound buffers.

**How to apply:** Keep sweeps unref'd/self-stopping, close slow streams using the reconnect/snapshot protocol, and ensure stale close handlers cannot remove replacements.

**Rule:** Do not attribute production RSS growth to a heap leak from one process-memory snapshot or a synthetic retention example.

**Why:** A bounded real formula-runtime reproduction showed stable post-GC heap despite increasing RSS. This does not clear other workloads or native allocations.

**How to apply:** Compare heap, external buffers, RSS and active work over time. Diagnostic logs must contain aggregate counters only, no payloads or secrets; keep profiling read-only and off production unless explicitly scoped.