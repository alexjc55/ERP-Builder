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

**Watch out — duplicated per-route `isUniqueViolation` helpers.** Several routes
(`page-fields.ts`, `fields.ts`, `modules.ts`, `translations.ts`) each define their
OWN local `isUniqueViolation(err)`. These were originally top-level-only checks
(the bug above). The `page-fields.ts` copy was the root cause of a `record_links`
500 on setting a relation link when a one-to-many/one-to-one cardinality conflict
fired: the wrapped 23505 was misclassified and re-thrown as a 500, which also
cascaded into a downstream "Сначала заполните родительское поле" (the parent link
never saved). Fixed page-fields' copy to walk the cause chain. The other copies
may still be top-level-only — if any of those routes 500s on a duplicate, apply
the same cause-chain walk there.
