---
name: Collaborative table editing
description: Durable realtime-presence, privacy, optimistic-concurrency, and lock-order rules for records tables.
---

Use authenticated streaming `fetch` for SSE so the bearer token stays in the
Authorization header; never put the token in the URL. Presence is ephemeral,
per page, soft (not a lock), and must remain privacy-safe for restricted roles.
Mutation notifications are opaque page/table invalidations; record IDs, field
keys, versions, values, and emails must not be broadcast to recipients that may
have different row or field visibility. Editing coordinates are shown only when
the recipient has unrestricted row, status, and field visibility.

**Why:** A page-level subscription is broader than per-record RBAC. Broadcasting
record identifiers or edit coordinates to every page viewer leaks hidden rows
and fields even when the normal read endpoints are correct.

**How to apply:** Any new realtime event or presence attribute must be reviewed
as an independent read surface and either be recipient-filtered under the full
records boundary or reduced to an opaque invalidation.

Every write that changes a record's effective scalar, page-local, status,
relation, archive, or merge state must participate in optimistic concurrency.
An effective change advances the relevant version exactly once, including
link-only changes; combined scalar+link changes must not double-increment.

**Why:** Version gaps allow stale editors to overwrite relation or merge changes,
while double increments create false conflicts. Database triggers cover update
paths, but link-only state changes still require one deliberate record touch.

**How to apply:** Compare expected versions under transaction locks, lock merge
participants and relation/page resources in stable order, and update/touch the
surviving record once whenever its effective state changes. On a client 409,
keep the local draft mounted, refresh the server version, and reset only the
one-shot submit guard so the user can retry without retyping.

Any presence/conflict decoration around an active cell editor must keep the same
React wrapper tree whether collaborators are present or absent. Toggle only the
outline/popover contents, never the wrapper that owns the editor.

**Why:** Presence broadcasts can arrive while a user is typing. Swapping between
a plain cell and a decorated cell remounts the input and silently resets its
local draft to the last server value.

**How to apply:** Render collaboration wrappers unconditionally and conditionally
render only visual children inside them. Two-session browser coverage must type a
draft before the remote presence/edit transition and assert it survives.

A successful version-changing write must also publish its internal record/page
event after the write (and after commit for multi-row transactions), carrying
that record's own resulting version. Failed CAS, rollback, and true no-op paths
must publish neither events nor audit entries.

**Why:** Version correctness alone does not refresh connected tables or trigger
event-driven automations; emitting before success creates phantom history and
invalidations for writes that never happened.

**How to apply:** Treat archive/import/relation cascades and other shared helpers
as event producers, not just the obvious scalar update endpoints. Return enough
post-write metadata to emit once, deduplicated, only after durable success.

User references stored in JSONB need a transaction-scoped write barrier during
user merge: every writer takes sorted shared advisory try-locks for referenced
user IDs in the same transaction as its final write, while merge takes sorted
exclusive locks before its authoritative scan and source-user deletion.

**Why:** Row locks cannot prevent a predicate phantom where a previously
non-matching record starts referencing a user after merge's initial scan,
leaving a dangling JSONB reference after the user is deleted.

**How to apply:** Writers fail fast with a retryable conflict if a merge owns the
exclusive barrier, then revalidate user liveness while holding shared locks.
Keep shared-lock acquisition nonblocking when row locks are already held to
avoid deadlocks. User merge acquires its exclusive barriers before page-pair,
entity-record, and page-row locks.