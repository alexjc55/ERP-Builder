---
name: Table loading order
description: Freshness and responsiveness constraints when reducing bootstrap requests and table renders.
---

**Rule:** Avoid mounting the expensive full table before its row projections settle; show a lightweight loading state while keeping request effects active.

**Why:** Browser profiling showed that rendering incomplete wide tables could block the main thread long enough to delay the passive effects that request their remaining data. Backend-only timing missed this delay.

**How to apply:** Measure response-to-request and response-to-paint on one browser clock; distinguish initial presentation from write hydration and never unlock page writes after a failed read.

**Rule:** A query started before an SSE subscription is established requires post-subscription reconciliation, even when its response arrives after the subscription.

**Why:** Simply skipping the first connection refresh can lose updates in the snapshot/subscription gap. Unconditionally refreshing instead causes unnecessary duplicate bootstrap work.

**How to apply:** Associate query starts with subscription generations; preserve offline loading and reconcile only when the query's subscription coverage is insufficient.

**Rule:** Manual refresh completion must not suppress or invalidate a newer filter, archive, or navigation request.

**Why:** A global “skip next fetch” flag can be set by an old manual refresh after the new request starts, canceling it without replacement.

**How to apply:** Tie refresh follow-up work to the winning request generation and test overlapping scope changes.