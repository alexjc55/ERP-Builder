---
name: Event System (Stage 14)
description: Internal event bus design — best-effort emission, the 5 core events, and the foundation it lays for automations/modules.
---

# Event System (Stage 14)

An internal event bus + durable log: `emitEvent(events, log?)` persists rows to the `system_events` table and then dispatches each persisted row to in-process subscribers (`subscribe(name | "*", handler)`). The 5 core events: `record.created`, `record.updated`, `record.deleted`, `status.changed`, `user.created`. This is the foundation for Stage 15 (Modules) — modules subscribe to events without touching the emit call sites.

## Rules / decisions

- **Emission is best-effort, exactly like `writeAudit`.** The persist is try/caught and returns on failure; every subscriber is isolated in its own try/catch; call sites `await emitEvent(...)` **after** the underlying mutation commits.
  - **Why:** the bus must never break or roll back the data write. A throwing subscriber must not affect the emitter or its peers.
  - **How to apply:** when adding a new emit point, place it after the DB mutation (and after the existing `writeAudit` call), never inside the same transaction as something that must not fail.

- **`status.changed` is emitted only when the status actually changes**, alongside the always-emitted `record.updated`, with payload `{from,to}`. Every payload carries `actorUserId`.

- **The `events` admin capability is JSONB-type-only — no migration.** Added to `RoleAdminCaps`/`NO_ACCESS_PERMS`. Old role rows lack the key ⇒ falsey ⇒ denied (secure default); superAdmin bypasses.
  - **Why:** adding a boolean key to a structured JSONB perm spec needs no DB change and stays backward-compatible.

- **`GET /events` is query-params-only (no path param)** ⇒ no Orval collision (see orval-param-collision.md). `limit`/`offset` must be integer-hardened (`Math.trunc` + `Number.isFinite` + positive, `limit` capped) because raw query strings can be floats/Infinity that would otherwise reach Drizzle `.limit()/.offset()` and 500. `actorName` is resolved from `payload.actorUserId` in one batched query, not stored on the row.
