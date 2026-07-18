---
name: Drizzle select-fragment column qualification
description: Raw SQL fragments passed directly as selected fields render table columns unqualified — correlated subqueries silently break; always wrap in sql``.
---

# Drizzle: raw SQL fragment as a selected field loses column qualification

**Rule:** never pass a raw `SQL` fragment containing table `Column` references directly as a value in `db.select({...})`. Always wrap it: `sql<T>\`${expr}\``.

**Why:** when a fragment is passed directly, Drizzle renders its `Column` chunks UNQUALIFIED (`"id"` instead of `"entity_records"."id"`). If the fragment is a correlated subquery with its own FROM (e.g. `record_links rl`), the unqualified column resolves to the INNER table (`rl.id`) — the correlation is silently wrong and the expression returns NULL/garbage with no error. The same fragment works fine in `.orderBy()` / `.where()` (qualified there), so the bug only shows in SELECT projections.

Verified (drizzle-orm in this repo):
- `select({ k: expr })` → `... rl.source_record_id = "id" ...` → all NULL.
- `select({ k: sql\`${expr}\` })` → `... = "entity_records"."id"` → correct.

**How to apply:** any helper returning a correlated scalar (`relationLinkedIdScalar`, `relationValueScalar`, `pageLocalValueExpr`, …) must be wrapped in `sql\`\`` at every `.select({...})` call site. pivot-compute already does this; the mirror-grouping rowGroups query was the one that didn't (broken expand-all headers).
