---
name: ERP Workflow Engine (Stage 10)
description: How status transitions are modeled and enforced in the ERP Builder — the design decision to build on entity_statuses and the concurrency rule for the records update path.
---

# Workflow Engine design

The workflow engine is built **on top of the existing per-entity `entity_statuses`**, NOT as a parallel `workflow_statuses` table. A "workflow" = the set of `entity_transitions` rows for an entity (from-status → to-status, with allowed roles, required field keys, and `set_field` actions).

**Why:** statuses already exist per entity and drive record lifecycle; a second status concept would duplicate and desync. Keep one source of truth.

## Enforcement boundary (server is hard; client cosmetic)
- Entities with **no transitions** keep free status change (backward compatible). A record whose current status is **null** is not workflow-governed (no transition can originate from null) → free change.
- **superAdmin bypasses the entire workflow** (incl. actions), consistent with RBAC.
- Otherwise a status change must match a defined transition (else 422), pass `allowedRoleIds` (empty list = all roles; else 403), apply `set_field` actions **before** final validation, and require `requiredFieldKeys` to be non-empty (else 422).

## Wildcard "from any status" transitions
A transition's `fromStatusId` is **nullable**: `null` means "from any status" (a wildcard into `toStatus`, regardless of the record's current status).
- **Resolution precedence (critical):** when enforcing a status change, match a **specific** `from→to` transition first; only if none exists fall back to the **wildcard** (`fromStatusId === null && toStatusId === target`). Never let a wildcard shadow a specific edge.
- **Uniqueness:** two partial unique indexes, not one constraint — specific edges unique on `(entityId, fromStatusId, toStatusId)` where `fromStatusId is not null`; at most one wildcard per target on `(entityId, toStatusId)` where `fromStatusId is null`.
- **Create vs update null semantics:** on PUT, distinguish *omitted* `fromStatusId` (keep current) from *explicit null* (set wildcard) via `"fromStatusId" in body` — `?? null` alone conflates them. Status-belongs validation must skip null `fromStatusId`.
**Why:** admins wanted "any status → X" shortcuts without enumerating every source; conflating omitted/null on update would silently turn an unrelated edit into a wildcard.

## Concurrency rule (critical)
Validate-then-write on the record status is a **compare-and-set**: when a transition is enforced, the final `UPDATE` is guarded on the row's status still equaling the from-status we validated against; 0 rows affected → **409** (retry). 
**Why:** without the guard, two concurrent status-changing PUTs both validate against the same old status and the second write can skip the transition graph from the now-current status — bypassing the authorization boundary. **How to apply:** any future code path that changes a workflow-governed field after a read-validate step must re-assert the validated precondition in the write predicate (or lock the row), never trust the earlier read.
