---
name: Validation concurrency
description: Why destructive install, collaboration E2E, and PostgreSQL fixture release gates must not run concurrently.
---

The dependency-install validation, collaboration/relation E2E, and PostgreSQL fixture release gates must share a repository-specific execution lock.

**Why:** A clean workspace install creates enough concurrent I/O to change the timing of the collaboration conflict scenario. The E2E can then refresh before submitting the stale edit, return 200 instead of the expected 409, and time out despite both checks passing independently.

**How to apply:** Route every PostgreSQL fixture command through the shared lock runner, retain each test runner's internal sequential mode, and use the same lock in destructive install and timing-sensitive E2E workflows. Avoid nested acquisition; source the helper for wrapper bodies and let delegated DB package commands acquire directly.