# Formula report readiness

Run `corepack pnpm run test:formula-report-readiness` for mock-only runner tests.

The explicit DB readiness gate is `corepack pnpm run validate:formula-reports`.
It fails before starting any suite unless both process-local inputs are supplied:

- `FORMULA_REPORTS_CONFIRMED_DEVELOPMENT=1`
- `FORMULA_REPORTS_DEV_FINGERPRINT=<independently verified development fingerprint>`

An authorized operator must first select the **development** database through the
database tooling and obtain its identity with this read-only query:

```sql
SELECT current_database() AS database,
  md5(coalesce(string_agg(id::text || ':' || entity_key, ',' ORDER BY id), '')) AS fingerprint
FROM entities;
```

Confirm that this is the intended development database. Supply the returned
fingerprint explicitly to the readiness command. Do not generate it from the
runner's current connection and automatically approve that connection. The
fixtures separately verify their local hostname, database name and fingerprint
before any writes. Never disable those checks to run against production.

The gate launches the three registered API package commands sequentially. Each
command acquires the existing shared validation lock; the gate acquires no lock.
Do not invoke the gate from inside another lock-owning wrapper.

Success requires every suite to exit zero and emit exactly one complete Node
test summary with positive test count, all tests passed, and no skipped,
cancelled, failed or TODO tests. Missing or malformed output and timeout are
failures, not evidence of readiness. The gate stops at the first failing suite.
Ordinary low-level package commands retain their opt-in skip behavior.

Child diagnostics are not echoed by the gate, to avoid leaking database
connection details. For a failed suite, investigate its guarded package command
in the same independently verified development environment.

Each package runs in its own POSIX process group, without an outer lock.
The five-minute timeout, SIGTERM/SIGINT, or excessive output stops that whole
group: SIGTERM first, then SIGKILL after a two-second grace period, even if the
package leader has already exited. No later suite starts after interruption.
Normally completed suites retain their existing fixture teardown behavior.
Forced termination is NOT proof of fixture cleanup or transaction rollback:
inspect the independently confirmed development database before retrying.
Descendants must not detach into separate process groups. This runner is for
Linux/POSIX; SIGKILL of the orchestrator itself cannot be handled.