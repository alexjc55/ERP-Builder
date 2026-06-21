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
**How to apply:** both link-creation and relation-type-change run inside a transaction that takes `SELECT … FOR UPDATE` on the *relation row* before reading/copying the type or checking compatibility. This serializes the two operations so a type change and a link insert can never interleave to produce a drifted row. Verified: concurrent link-create + type-flip yields zero drift.

## Relation-type change with existing links: compatibility check, then rewrite the copied type in lockstep
A type change is NOT forbidden while links exist (that earlier blanket block was too strict). Instead, under the relation row lock, count existing links that already violate the new type's cardinality — `group by source having count(*)>1` when the new type needs source-unique (one_to_one/many_to_one), `group by target …` when it needs target-unique (one_to_one/one_to_many); many_to_many needs neither and is always compatible. If any conflicts, return a 409 naming the conflicting counts (never auto-delete — losing which link to keep is a blind data-loss decision). If compatible, set `relations.relationType` AND `UPDATE record_links SET relation_type = <new>` for that relation in the SAME transaction.
**Why:** the type is a cardinality RULE evaluated off the denormalized `record_links.relationType` column; rewriting it without first proving the data fits would just make the partial-unique UPDATE throw 23505. The needsSource/needsTarget predicates MUST mirror the index WHERE clauses exactly or the check diverges from what the DB will accept.

## Drizzle wraps pg driver errors — walk err.cause for 23505 / 23503
The pg error `code`/`constraint` are NOT always on the top-level error thrown by Drizzle; they can sit on `err.cause`. Handlers must walk the cause chain (a few levels) to find the code and read `constraint`, then map the constraint *name* to an HTTP status. Routes that pre-check app-side rarely hit this path, so the bug stays latent until a route relies on the DB constraint catch.

## Pre-insert existence checks are not enough under concurrency — also catch the FK violation
Checking that the source/target records exist *before* the insert does not prevent a concurrent delete between the check and the insert; the FK fires (`23503`) and would surface as a 500. The catch block must walk the cause chain for `23503`, inspect the constraint name to tell which column failed (`source_record_id` → 404, `target_record_id`/`relation_id` → 400), and return a deterministic 4xx. **Why:** records are CASCADE-linked and deletable any time; only the DB FK is authoritative at insert time.

## resolveRelationEntityField is shared by READ and WRITE paths — gate lookup acceptance
`resolveRelationEntityField` backs both the read picker (`POST /entities/:id/related-candidates`) and the write `PUT /entities/:id/related-link`, plus dependent-field resolution. Relaxing its field-type filter to accept `lookup` for the read picker silently leaked into the write path, letting a read-only `lookup` field mutate a link.
**Why:** lookups are read-only projections through a relation; they must never be a write target.
**How to apply:** the resolver defaults to relation-only; lookup is opt-in via an `allowLookup` flag passed ONLY by the candidates read handler. Any new caller defaults to relation-only — never widen the resolver's type filter unconditionally.

## OpenAPI: avoid path + query params on the same endpoint
In this repo's Orval setup, an endpoint with BOTH a path param AND a query param triggers a TS2308 duplicate-export collision between `generated/api.ts` and `generated/types/`. Keep list endpoints path-only; filter client-side instead (e.g. record links return all links, each carrying its relationId).
