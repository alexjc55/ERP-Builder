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

Global online-user presence may aggregate the existing ephemeral page sessions,
but guests must receive neither named SSE presence nor named global presence.
Current-page metadata is disclosed only when the viewer can access that page;
never include editing coordinates, record IDs, query strings, or history.

**Why:** An online-users widget is a new cross-page read surface. Reusing page
presence without a separate disclosure review leaks identities and restricted
page context, especially to passwordless guests.

**How to apply:** Keep the registry TTL-only and process-local while deployment
is single-process. Before adding API workers/replicas, move presence to a shared
ephemeral store/pub-sub so session counts and current pages remain complete.

Long-lived SSE authorization must use fresh request-scoped permissions before
each outbound frame, not the original request's cached permissions. Coalescing
while authorization runs must retain full invalidation coverage.

**Why:** A connection-time allow decision survives role revocation; replacing
queued record events by event name can silently lose changes to other records.

**How to apply:** Reauthorize snapshots, presence, invalidations and keepalives;
fail closed on denial/error/timeout. Coalesce mutations to a whole-table
invalidation, clear client presence on terminal denial, and test revocation
without first disconnecting the original transport.

Permission denial ends the current stream, not the possibility of future access.
Use a separate slow authorization probe (30 seconds) after 403; keep presence
writes stopped and old editing coordinates cleared until authorization succeeds.
401 must not enter this polling loop.

**Why:** A permanently stopped hook could not discover regranted permissions
without navigating away. Fast transport reconnect loops would instead repeatedly
hit denied endpoints and risk retaining stale editing state.

**How to apply:** Keep one cancellable recovery timer owned by the current
page/user scope; recheck server authorization on every attempt. Successful
recovery starts a fresh subscription generation and authoritative table refresh.
Verify repeated denials, restored snapshots, no duplicate stream, and teardown.

Collaboration failure explanations must use safe categories, never raw server
messages. A permission/session denial hides the record surface and presence;
a network interruption can retain the authorized snapshot. Keep the notice
available even when cached record permissions already deny the page.

**Why:** A connection badge alone does not tell the user whether to wait or
sign in, while cached records after explicit denial can expose revoked data.

**How to apply:** Reuse existing retry ownership; the explanation must not
create additional subscriptions or timers. Clear it on an authorized connection.
Authorization denial is latched for the page/user: failed probes (including
503 and transport failures) cannot downgrade it to a network-only warning or
resume presence writes. Only successful authorization releases that boundary.

Failure explanations must stay visible when mobile toolbars are collapsed.
**Why:** The mobile default hides the toolbar; an outage warning inside it is
present in the DOM but invisible to the user.
**How to apply:** Assert actual visibility and viewport bounds, not only text
or attributes, for localized connection warnings with collapsed mobile controls.

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

Conflict testing must preserve the stale writer's read access until the stale request reaches CAS.

**Why:** If a competing move first removes the row from the writer's page, a not-found denial is correct and must not reveal the hidden row's current version. That is different from testing a version conflict.

**How to apply:** For a real delayed conflict response, advance the version with a still-visible edit, obtain the stale write's actual response, then move the authoritative row outside the page before releasing that response to the browser.

When a nested editor commits a version-changing mutation before its parent form
is saved (for example, a relation picker writing `record_links`), the mutation
must return the resulting base-record version and the parent must synchronously
adopt it as its next CAS token. Keep parent Save disabled while the nested write
is active; never blindly retry the parent's stale full-value snapshot.

**Why:** React state propagation can lag one interaction behind, so a successful
link write followed by Save used the pre-link version and showed a false conflict
even though the relation had already changed.

**How to apply:** Forward the returned version through every shared form wrapper,
store the latest token in a ref (state may mirror it for rendering), and read the
ref at submit time. Release nested-edit blocking on success, failure, and cancel.

Initialize a linked-record editor from a fresh values/version pair on every
opening, not from cached detail data while a background refetch is pending.
After initialization, background reads must not overwrite the user's draft.

**Why:** Cached values made a saved comment appear lost when reopening the same
record, and the cached version could cause a false 409 on the following save.
Changing the version alone would hide conflicts and risk overwriting newer data.

**How to apply:** Block editing until the opening read succeeds, reject late
responses after close/record switches, and keep genuine CAS conflicts explicit.

Editor regression tests must use the real form serializer and model server
merge semantics: omitted fields preserve their stored values, explicit blanks
clear them. Do not substitute a pass-through serializer or full replacement.

**Why:** A linked-editor browser test passed deletion with both shortcuts, while
the actual serializer dropped the cleared comment and the server kept old text.
The user reproduced the failure immediately after the claimed fix.

**How to apply:** Cover clear/save/reopen as well as populated updates, assert
the outbound clear marker, and keep create-time omission separate from updates.
Include inactive metadata in the same fixture: explicit nulls exposed an older
linked-editor filtering gap and caused unknown-field rejection. Test metadata
must not assume that all returned definitions are writable or active.

When one mounted records component changes page/RBAC scope, prior rows and
related-value projections must be withheld before paint, then refetched under
the new scope.

**Why:** Fetch dependencies alone start the correct replacement request but can
leave the old permission-scoped result visible for one render, causing stale UI
and a transient data disclosure.

**How to apply:** Key displayed results by the effective page scope or clear all
row/relation display state in a layout effect before the browser paints; include
the effective scope in every relevant fetch dependency.

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