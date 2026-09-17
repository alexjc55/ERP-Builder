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

**Rule:** A same-scope background refresh retains the last successful visible snapshot; replacement row values, formulas and cell projections publish together. Initial or changed-scope loading must not reuse another scope's values.

**Why:** Replacing populated cells with loading indicators caused columns to shrink and redirected users' next clicks. Retaining projections independently also mixed old and new formula inputs.

**How to apply:** Stage replacement responses by generation, abort staging on failure/supersession, expose stale errors with retry, and keep write readiness separate from display readiness. Preserve open picker/editor trees during refresh while guarding writes; clear transient editing state on scope changes. Manual refresh must dispatch only one projection generation.

**Rule:** Keep the last accepted same-query totals mounted during refresh or failure. Complete server aggregates/common group values may publish before cell projections when group topology and visible row membership remain unchanged.

**Why:** Clearing totals readiness on every request unmounted the totals strip and shifted the table. Waiting for unrelated cell projections also delayed already-computed group values. Aggregates are independently authoritative server results, unlike formulas recomputed from mixed cell inputs.

**How to apply:** Never infer group sums from the displayed page of rows. If group keys/order/counts or row assignments change, retain atomic replacement with the row bundle. Clear groups as well as rows/totals before paint on a new query or permission scope.

**Rule:** An acknowledged inline write must not wait for unrelated background projections before showing its saved scalar. The write's identity and editor lifetime are distinct from read request generations.

**Why:** Complete background snapshot staging can delay the writer's own feedback. Reusing read generations for write ownership lets an intervening refresh discard a valid acknowledgement; scope equality alone cannot reject a response after navigating away and back.

**How to apply:** Retain explicit saving feedback until acknowledgement, publish only server-confirmed values/versions, reject stale callbacks by captured invocation identity, and close only the initiating editor lifetime. Preserve source-page invalidation and automation follow-up for every save surface when relocating mutation callbacks.

**Rule:** Collaboration decoration must have negligible cost for inactive cells; do not mount a full popup controller for every cell.

**Why:** Profiling a 200-row table found the browser saturated by collaboration wrappers and development JSX construction, even with bounded requests and cached formulas. Keeping values visible was not enough to keep clicks responsive.

**How to apply:** Profile browser CPU as well as network latency. Keep editor children mounted independently from tooltip visibility, index presence once, and create expensive floating UI only for an active tooltip. A passing timeout test is not proof of instant interaction; report measured click latency.

**Rule:** Evaluate editor responsiveness on a fresh production build and measure actual browser input-to-paint separately from automation wall time.

**Why:** Development JSX instrumentation exaggerated whole-table render costs. After isolating rows, Playwright locator/actionability work and floating-menu layout dominated total test time and obscured the smaller improvement in actual browser input latency.

**How to apply:** Compare the same fixture and browser clock before/after; retain automation wall times as diagnostics rather than silently substituting metrics. Budget the actual pointer-to-visible-frame interval, keep row/cell-count assertions, and never relax version/scope checks to improve a timing result.

**Rule:** Row render inputs must remain compared immutable snapshots; only event commands may use latest-committed callbacks.

**Why:** Skipping callback or permission dependencies to force memoization can preserve stale access checks, old projections or incorrect edit state. Stable event identity alone cannot safely represent render data.

**How to apply:** Pass row-local editing/pending/selection state separately, track every shared context input, and retain ordinary shallow comparison. A changed locale, permission, style or projection must still invalidate the affected render.