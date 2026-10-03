---
name: Validation concurrency
description: Why destructive install, collaboration E2E, and PostgreSQL fixture release gates must not run concurrently.
---

The dependency-install validation, collaboration/relation E2E, and PostgreSQL fixture release gates must share a repository-specific execution lock.

Fixture automations must either be awaited to completion or omitted from tests that do not exercise them.

**Why:** A successful record-write response does not guarantee that background automation effects have finished; their events can arrive after fixture deletion and fail cleanup.

**How to apply:** Keep automation fixtures in automation/collaboration coverage, but omit them from short policy-only cases. Do not solve this with arbitrary cleanup delays or weaker cleanup assertions.

Keep a pass-through API route installed for the lifetime of browser tests that
add and remove individual write barriers.

**Why:** Removing Chromium's last interception route during post-conflict lane
refresh can strand an already-paused request; traces show a request with no
response while other lanes finish, causing missing or duplicate cards.

**How to apply:** Install the pass-through before the specific barriers and close
it with the browser context. Forward bytes unchanged; never fabricate responses
in real-session tests.

Compare database immutability snapshots in primary-key order, captured after
any deliberate fixture mutation.

**Why:** PostgreSQL does not promise SELECT order, and fixture updates can
advance version/timestamp metadata. Comparing unsorted snapshots or snapshots
across test-authored writes gives false failures unrelated to the UI action.

**How to apply:** Establish the baseline immediately before the action under
test; assert complete rows remain equal after that action, with stable ordering.

**Why:** A clean workspace install creates enough concurrent I/O to change the timing of the collaboration conflict scenario. The E2E can then refresh before submitting the stale edit, return 200 instead of the expected 409, and time out despite both checks passing independently.

**How to apply:** Route every PostgreSQL fixture command through the shared lock runner, retain each test runner's internal sequential mode, and use the same lock in destructive install and timing-sensitive E2E workflows. Avoid nested acquisition; source the helper for wrapper bodies and let delegated DB package commands acquire directly.

DB-test discovery must remain static; never execute or import fixture modules to decide whether they mutate the database.

Resolved function symbols may point to declarations, not just arrow/function
expressions. Preserve authentic transaction provenance for all supported callback
forms, including imported and aliased named callbacks.

**Why:** Expanding helper resolution once regressed previously detected named
transaction callbacks by checking only expression node kinds after resolution.

**How to apply:** Pair each new callable resolution form with real-DB mutation
and read-only negative fixtures; test the transaction parameter as well as
ordinary helper arguments.

**Why:** Runtime classification could perform the very unguarded mutation the inventory is intended to prevent. Static discovery catches naming mistakes but is not a sandbox for arbitrary helper functions or dynamically generated SQL.

**How to apply:** Keep regression fixtures as inert source strings in temporary directories. Preserve explicit DB suffix/locked-command registration even when extending mutation inference.

The workspace can carry a production environment label even while its configured database is the development database.

**Why:** A guarded browser fixture skipped on that label; a read-only connection fingerprint matched the database selected explicitly through the development SQL tool.

**How to apply:** Never assume the label is wrong or bypass fixture guards blindly. Confirm the actual database target independently before fixture writes; retain production guards in committed tests. A verified development target may use development labels only for the specific test process.

Release readiness must distinguish an intentionally skipped guarded DB suite from a passing suite. An execution gate must require positive completed-test counts and zero skipped/failed/cancelled/TODO results.

**Why:** The low-level fixture opt-in protects data by skipping by default, but exit code zero alone falsely advertises report correctness. Auto-generating an approving fingerprint from the same unknown connection would defeat independent identity confirmation.

**How to apply:** Require explicit independently verified development identity at the gate, preserve fixture-side checks, and invoke lock-owning package commands sequentially without another lock. Keep ordinary opt-in fixture commands separate from the readiness verdict.

Stopping a validation launcher is not equivalent to stopping its descendant fixture runners, and stopping runners is not proof of database cleanup.

**Why:** Package launchers can exit while descendants still execute and retain inherited lock descriptors. Forced termination bypasses JavaScript finally/after cleanup; committed fixture rows may remain.

**How to apply:** Terminate the dedicated process group with bounded graceful escalation, including after leader exit. Test interruption using mock descendants and real file locks, not live DB writes. Require development-data inspection after forced termination rather than automatically retrying.

Chromium's offline network emulation does not reliably terminate an already-open fetch-based SSE reader.

**Why:** The browser continued reporting a connected stream after offline emulation, so that alone did not exercise reconnect.

**How to apply:** Cancel the actual stream transport through a test-owned AbortController while blocking network retries. Keep native fetch and server bytes unchanged; assert disconnection, missed updates, reconnection and unchanged document time origin.

SSE authorization-retry tests should interrupt only SSE, not all browser networking.

**Why:** Recovering the whole network can retry metadata reads and replace the board with a Forbidden screen before SSE retries. That is safe behavior, but makes an assertion about the SSE response nondeterministic.

**How to apply:** Abort the native stream and block only stream reconnect requests while changing isolated permissions; unblock and assert a real 403. Keep independent test fixtures for authorization and mutation-race scenarios.