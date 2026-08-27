---
name: Inbound webhook integrations
description: Durable security, execution, matching, and concurrency rules for generic external-system ingestion.
---

# Inbound webhook integrations

**Rule:** Treat every integration as a passwordless technical user with one or more existing roles. Mapping configuration may narrow those permissions but must never widen record, row, field, page, or relation access.

**Why:** External systems act inside the same ERP security model as interactive users; a separate privileged import path would make the configured role misleading and create data leaks.

**How to apply:** Re-apply the full role union and all write/read boundaries at execution time. Inline customer creation is allowed only through an editable `user` field with `allowCreate`, uses an administrator-fixed non-privileged role, and never accepts a role from payload data.

**Rule:** Receipt idempotency and business execution atomicity are separate boundaries. The event ID plus payload hash deduplicates receipt; all mapped writes, audit rows, versions, links, and the terminal delivery status commit in one transaction.

**Why:** Marking a delivery complete after committing business rows leaves a crash window where recovery repeats already committed work.

**How to apply:** Keep step logs and `completed` in the business transaction. Emit best-effort system events only after commit. Failed and dry-run transactions must not emit mutation events.

**Rule:** Every delivery acquires globally named, sorted target locks before executing steps; lock names must not include the integration ID. Relation rows are locked in sorted order before record rows.

**Why:** Different integrations can target the same ERP identity, and per-integration locks permit duplicate customers/orders. Late relation locks can deadlock against interactive relation writers.

**How to apply:** Serialize shared entity/page/user targets across all integrations, acquire configured relation locks before records, and lock linked records in stable numeric order. The delivery row remains locked through commit so stale recovery cannot execute a long-running delivery twice.

**Rule:** Mapping versions are immutable drafts; test and publish always operate on the exact version just saved.

**Why:** Publishing a previously loaded “latest” version can silently activate stale rules after a save.

**How to apply:** Save → use the returned version ID for dry-run/publish. A live delivery stores its chosen published version so later mapping edits cannot change in-flight behavior.