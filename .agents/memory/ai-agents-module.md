---
name: AI agents module
description: External-LLM API keys (Variant A) — agent = passwordless backing user + role + method-level capability mask; trimmed agent-facing OpenAPI.
---

# AI agents module (Aug 2026)

The user's employees connect EXTERNAL LLM agents (ChatGPT Actions etc.) to the ERP API. The ERP hosts no LLM — it only issues keys (Variant A, explicitly chosen; a built-in chat "Variant B" was discussed and rejected for v1).

## Rules that must stay consistent
- An agent is backed by a **passwordless user account** (same precedent as guest links). RBAC, own-scope, hidden fields/statuses, page perms and audit attribution all flow through the normal user pipeline — never build a parallel permission path for agents.
- Keys are opaque `agk_...` bearer tokens (NOT JWTs), stored as SHA-256 hash, shown once. requireAuth branches on the prefix.
- The **capability mask narrows the role at HTTP-method level** (full / read / read_edit / read_edit_create / read_edit_create_delete) and must never widen. Reads = GET + POST `.../records/query`. POST `/records/merge` and POST `/records/bulk` with `action:"delete"` count as DELETE.
- Agent auth caches key lookups (60s, incl. negative results) — after admin changes call the cache invalidators; a just-created key can be "invalid" for up to 60s if it was tried before creation.
- The whole feature is gated by the `ai_agents` system module row (seeded idempotently at server startup; disabled by default). Module off ⇒ all agent keys 401.
- Deleting an agent deactivates (never deletes) the backing account so audit/authorship references stay valid.
- **Why:** the mask exists so an admin can hand a powerful role to an agent but still hard-cap writes; the boundary must live in requireAuth (defense-in-depth like the guest read-only guard), not in per-route checks.

## Agent-facing OpenAPI
`GET /agent-api/schema` (public, shape only) serves a hand-written TRIMMED spec (~9 ops: entities/fields/statuses, records query, record, audit incl. `__status__` history, 3 file-download routes) because GPT Actions caps at ~30 operations. It is maintained by hand in the api-server — new agent-relevant endpoints must be added there deliberately, with LLM-oriented descriptions (file-value shapes, reserved sort keys, ISO dates).
