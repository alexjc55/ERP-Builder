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

**Rule:** Matching an existing target must finish before any external-file materialization. A skipped update has zero download/Drive effects; files may target entity file fields only, and their folder always comes from the field's managed-Drive configuration.

**Why:** Uploading before `updateOnMatch` is known creates orphaned files, while mapping-supplied folders would bypass administrator ownership and naming policy.

**How to apply:** Validate file destinations first, match and early-return second, then resolve names from final merged values and upload. Cleanup app-owned uploads only for pre-commit failures; never trash after a successful database commit.

**Rule:** Inbound file URLs use HTTPS with a DNS answer pinned into the TLS connection, public-address-only egress, per-redirect revalidation, an absolute whole-download deadline, and a streamed size cap.

**Why:** DNS-check-then-fetch is vulnerable to rebinding, and inactivity timeouts allow a trickle response to hold the business transaction indefinitely.

**How to apply:** Fail closed on non-public or unsupported address families, preserve the original hostname for SNI/certificate validation, and share the one deadline across DNS, redirects, connect, and body transfer.

**Rule:** Finding an existing user is independent of whether the selected user field permits inline creation; `allowCreate` and role/field/email restrictions apply only after all find strategies miss.

**Why:** Disabling user creation must not make existing linked users undiscoverable.

**How to apply:** Run system-ID and profile-field matches first. Enter the guarded creation path only for a create/upsert operation with no match.