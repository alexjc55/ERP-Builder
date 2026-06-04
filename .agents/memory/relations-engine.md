---
name: Relations engine — cardinality & error handling
description: Durable decisions for entity-to-entity relations and record links (DB-enforced cardinality, Drizzle error wrapping, concurrency lock).
---

# Relations engine

## Cardinality is enforced by partial unique indexes on a denormalized type
Record links carry a denormalized `relationType` copied from the parent relation. The four cardinalities are enforced purely by DB indexes on `record_links`:
- duplicate-pair: unique(relationId, source, target)
- source-unique partial index WHERE type IN (one_to_one, many_to_one)
- target-unique partial index WHERE type IN (one_to_one, one_to_many)

**Why denormalized:** a partial index predicate can only reference columns of its own table, so the relation's type must live on `record_links` for the index to discriminate.

## The denormalized type MUST stay in lockstep with the parent — guarded by a row lock
Risk: if `record_links.relationType` ever drifts from `relations.relationType`, the partial indexes enforce the wrong cardinality.
**How to apply:** both link-creation and relation-type-change run inside a transaction that takes `SELECT … FOR UPDATE` on the *relation row* before reading/copying the type or checking "no links exist". This serializes the two operations so a type change and a link insert can never interleave to produce a drifted row. Type changes are additionally forbidden while any links exist. Verified: concurrent link-create + type-flip yields zero drift.

## Drizzle wraps pg driver errors — walk err.cause for 23505 / 23503
The pg error `code`/`constraint` are NOT always on the top-level error thrown by Drizzle; they can sit on `err.cause`. Handlers must walk the cause chain (a few levels) to find the code and read `constraint`, then map the constraint *name* to an HTTP status. Routes that pre-check app-side rarely hit this path, so the bug stays latent until a route relies on the DB constraint catch.

## Pre-insert existence checks are not enough under concurrency — also catch the FK violation
Checking that the source/target records exist *before* the insert does not prevent a concurrent delete between the check and the insert; the FK fires (`23503`) and would surface as a 500. The catch block must walk the cause chain for `23503`, inspect the constraint name to tell which column failed (`source_record_id` → 404, `target_record_id`/`relation_id` → 400), and return a deterministic 4xx. **Why:** records are CASCADE-linked and deletable any time; only the DB FK is authoritative at insert time.

## OpenAPI: avoid path + query params on the same endpoint
In this repo's Orval setup, an endpoint with BOTH a path param AND a query param triggers a TS2308 duplicate-export collision between `generated/api.ts` and `generated/types/`. Keep list endpoints path-only; filter client-side instead (e.g. record links return all links, each carrying its relationId).
