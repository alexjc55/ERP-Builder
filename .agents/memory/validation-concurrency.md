---
name: Validation concurrency
description: Why the dependency-install and collaboration E2E validations must not run concurrently.
---

The dependency-install validation and collaboration E2E must share a repository-specific execution lock.

**Why:** A clean workspace install creates enough concurrent I/O to change the timing of the collaboration conflict scenario. The E2E can then refresh before submitting the stale edit, return 200 instead of the expected 409, and time out despite both checks passing independently.

**How to apply:** Keep these two validations serialized when changing their launch scripts or adding other resource-intensive validation work. New lightweight checks do not need the lock unless concurrent runs reproduce timing failures.