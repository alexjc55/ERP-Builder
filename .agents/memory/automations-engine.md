---
name: Automations engine
description: Per-entity «Автоматизации» — trigger + type-aware conditions + ordered actions; admin-authoritative execution, cascade/SSRF/idempotency guards, and the UI type-coercion rule.
---

# Automations engine

Per-entity automation: a trigger, optional type-aware conditions, and an ordered list of actions. Stored in `entity_automations` (JSONB config) with a `entity_automation_runs` log. Managed under its own admin area alongside Поля/Статусы/Связи/Виды/Процессы/Данные.

## Boundary decisions (must stay consistent)
- **Actions run AS SYSTEM** — admin-authoritative. They use `systemCreateRecord/systemUpdateRecord` and intentionally bypass the *initiator's* RBAC (row/field perms). The only access boundary is on the **management routes**, gated by the new RBAC cap `automations` (superAdmin bypasses via the shared `requireAdmin`). Do not "fix" actions to re-apply the initiator's records boundary — that contradicts the design.
- **`change_status` OVERRIDES «Процессы» (workflow)** — it sets any status directly, ignoring the transition graph / required-field rules. This is deliberate; it is the escape hatch above the workflow engine.

## Safety guards (do not weaken)
- **Cascade guard**: `AsyncLocalStorage` chain context + `MAX_CASCADE_DEPTH=8` + per-`(automationId,recordId)` dedupe in the chain, so create/update actions can't infinitely re-trigger automations.
- **SSRF guard** on the `webhook` action: http/https only, DNS lookup, deny private/loopback ranges, `redirect: error`, timeout.
- **Date sweep idempotency**: the `date_reached` scheduler claims a row in `entity_automation_runs` via a unique partial index `(automationId, recordId, dedupeKey) where dedupeKey is not null` so a fire can't double-run.
- **Run log is best-effort**: all log writes are wrapped in try/catch and must NEVER break the record mutation path.

## UI rule that bit us (type coercion for cross-entity mapping)
`create_record` / `update_records_where` actions map values into a **target** entity's fields. The server's `validateValues` strictly requires real `number`/`boolean` (not strings), so literal mapping values MUST be coerced by the **target field's type** before submit — not sent as raw strings.
- Target entity fields are fetched per-`ActionCard` (one card may target a different entity than the page). Lift them into a parent `targetFieldsCache: Record<entityId, Field[]>` (each card reports its loaded fields up via `onTargetFieldsLoaded`), then in submit build a target `fieldKey→Field` map and run literal values through `coerce(...)`, and pass that same map to `buildConditions(...)` for the `update_records_where.match` (so match conditions serialize type-aware too).
- The literal mapping editor itself should be the type-aware `ValueControl` bound to the **target** field, not a plain text `Input`.
**Why:** without this, any automation writing a literal into a numeric/boolean target field fails at runtime with a validation error and the action is marked failed.

## Trigger/action vocabulary
- Triggers: `record_created`, `record_updated`, `field_changed`, `status_changed`, `date_reached` (offsetDays).
- Actions: `set_field`, `change_status`, `create_record`, `update_records_where`, `webhook`.
- Conditions use a reserved status key `__status__` (mirrors the records-query convention).
- The records PUT path emits `changedFields` so `field_changed`/`status_changed` triggers can match.
