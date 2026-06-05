---
name: Drizzle wraps pg errors — SQLSTATE on err.cause
description: How to detect Postgres constraint violations (unique/FK) in API routes when using Drizzle.
---

# Detecting Postgres constraint violations behind Drizzle

Drizzle wraps the underlying `node-postgres` error, so the SQLSTATE code
(`23505` unique, `23503` FK) is usually **not** on the top-level thrown error —
it lives on `err.cause` (sometimes nested deeper).

**Rule:** any handler that maps a DB constraint violation to a clean 4xx must
**walk the `err.cause` chain** (bounded, ~5 levels) checking `obj.code`, instead
of reading only the top-level `.code`.

**Why:** A naive top-level `err.code === "23505"` check silently returns false,
the error re-throws, and the client gets an unhandled 500 (HTML error page).
This was the root cause of the `POST /translations` duplicate-key 500 bug.

**How to apply:** Reuse the existing pattern in
`artifacts/api-server/src/routes/relations.ts` / `transitions.ts` (their
`pgError` / cause-chain helpers). Wrap inserts/updates that touch a unique or FK
constraint in try/catch, detect via the cause-chain walk, return 409 (unique) or
422/409 (FK) with a JSON body, and re-throw everything else so Express 5's error
middleware still surfaces unexpected faults.
