---
name: Archive engine design
description: How record archival works (flag + lazy sweep) and the one non-obvious column that makes manual unarchive durable.
---

Archival is a flag on the record (`archivedAt`), never a separate table. A status
can be flagged `isArchiveTrigger` with `archiveAfterDays`. Auto-archival is a lazy
sweep that runs on every list/query read: it stamps `archivedAt` on rows dwelling
in a trigger status past `COALESCE(statusChangedAt, createdAt) + archiveAfterDays`.
`statusChangedAt` is the baseline and is stamped on create and on every status
change. A status change into a delay=0 trigger archives immediately.

**The subtle bit — `archiveExempt` (server-internal boolean, not in the API):**
without it, manual unarchive is useless for a record sitting in a delay=0 trigger
status, because the very next read's sweep re-archives it. Unarchive sets
`archiveExempt = true`; the sweep skips exempt rows. The exemption is cleared on
the next status change (a new status dwell re-enables auto-archival).

**Why:** auto-archive and manual unarchive otherwise fight each other; the
exemption gives manual action precedence until state genuinely changes.

**How to apply:** any future change to the sweep predicate must keep the
`archiveExempt = false` guard, and any new status-change path must clear it (set
`archiveExempt = false`) alongside resetting `statusChangedAt`. Changing status
away from a trigger never auto-unarchives — unarchive is always explicit.

**Guard — only a real archived→active transition grants exemption:** the
unarchive endpoint must check `existing.archivedAt != null` before setting
`archiveExempt = true`. Without this, calling unarchive on an already-active
record would grant a permanent (until next status change) opt-out of
auto-archival — a policy bypass through a legitimate endpoint.
