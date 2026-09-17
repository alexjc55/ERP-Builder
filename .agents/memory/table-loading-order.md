---
name: Table loading order
description: Freshness and responsiveness constraints when reducing bootstrap requests and table renders.
---

**Rule:** Progressive rows may mount before projections settle only when their projection requests are dispatched before publishing the rows. Pending dependent cells and totals must not look like authoritative empty/zero values.

**Why:** Browser profiling showed that rendering incomplete wide tables could block the main thread long enough to delay the passive effects that request their remaining data. Backend-only timing missed this delay.

**How to apply:** Measure response-to-request and response-to-paint on one browser clock; distinguish initial presentation from write hydration and never unlock page writes after a failed read. Keep dirty editors mounted during hydration, but a rejected not-ready commit must not consume the editor's exactly-once commit latch.

**Rule:** A query started before an SSE subscription is established requires post-subscription reconciliation, even when its response arrives after the subscription.

**Why:** Simply skipping the first connection refresh can lose updates in the snapshot/subscription gap. Unconditionally refreshing instead causes unnecessary duplicate bootstrap work.

**How to apply:** Associate query starts with subscription generations; preserve offline loading and reconcile only when the query's subscription coverage is insufficient.

**Rule:** Manual refresh completion must not suppress or invalidate a newer filter, archive, or navigation request.

**Why:** A global “skip next fetch” flag can be set by an old manual refresh after the new request starts, canceling it without replacement.

**How to apply:** Tie refresh follow-up work to the winning request generation and test overlapping scope changes.

**Rule:** A same-scope background refresh retains the complete last successful visible snapshot; replacement records, formulas, totals and projections publish together. Initial or changed-scope loading must not reuse another scope's values.

**Why:** Replacing populated cells with loading indicators caused columns to shrink and redirected users' next clicks. Retaining projections independently also mixed old and new formula inputs.

**How to apply:** Stage replacement responses by generation, abort staging on failure/supersession, expose stale errors with retry, and keep write readiness separate from display readiness. Preserve open picker/editor trees during refresh while guarding writes; clear transient editing state on scope changes. Manual refresh must dispatch only one projection generation.