---
name: Validation concurrency
description: Why destructive install, collaboration E2E, and PostgreSQL fixture release gates must not run concurrently.
---

The dependency-install validation, collaboration/relation E2E, and PostgreSQL fixture release gates must share a repository-specific execution lock.

**Why:** A clean workspace install creates enough concurrent I/O to change the timing of the collaboration conflict scenario. The E2E can then refresh before submitting the stale edit, return 200 instead of the expected 409, and time out despite both checks passing independently.

**How to apply:** Route every PostgreSQL fixture command through the shared lock runner, retain each test runner's internal sequential mode, and use the same lock in destructive install and timing-sensitive E2E workflows. Avoid nested acquisition; source the helper for wrapper bodies and let delegated DB package commands acquire directly.

DB-test discovery must remain static; never execute or import fixture modules to decide whether they mutate the database.

**Why:** Runtime classification could perform the very unguarded mutation the inventory is intended to prevent. Static discovery catches naming mistakes but is not a sandbox for arbitrary helper functions or dynamically generated SQL.

**How to apply:** Keep regression fixtures as inert source strings in temporary directories. Preserve explicit DB suffix/locked-command registration even when extending mutation inference.

The workspace can carry a production environment label even while its configured database is the development database.

**Why:** A guarded browser fixture skipped on that label; a read-only connection fingerprint matched the database selected explicitly through the development SQL tool.

**How to apply:** Never assume the label is wrong or bypass fixture guards blindly. Confirm the actual database target independently before fixture writes; retain production guards in committed tests. A verified development target may use development labels only for the specific test process.