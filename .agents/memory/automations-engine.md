---
name: Automations engine
description: Per-entity «Автоматизации» — trigger + type-aware conditions + ordered actions; admin-authoritative execution, cascade/SSRF/idempotency guards, and the UI type-coercion rule.
---

# Automations engine

Per-entity automation: a trigger, optional type-aware conditions, and an ordered list of actions. Stored in `entity_automations` (JSONB config) with a `entity_automation_runs` log. Managed under its own admin area alongside Поля/Статусы/Связи/Виды/Процессы/Данные.

## Boundary decisions (must stay consistent)
- **Actions run AS SYSTEM** — admin-authoritative. They use `systemCreateRecord/systemUpdateRecord` and intentionally bypass the *initiator's* RBAC (row/field perms). The only access boundary is on the **management routes**, gated by the new RBAC cap `automations` (superAdmin bypasses via the shared `requireAdmin`). Do not "fix" actions to re-apply the initiator's records boundary — that contradicts the design.
- **`change_status` OVERRIDES «Процессы» (workflow)** — it sets any status directly, ignoring the transition graph / required-field rules. This is deliberate; it is the escape hatch above the workflow engine.

## Execution is OFF the request path (non-blocking)
- The record mutation request must NOT await automation execution. Subscribers return `void` synchronously and the engine dispatch is deferred via `setImmediate` (`scheduleDispatch`). **Why:** the event bus awaits subscribers, so running actions inline made record create/update block on (potentially cascading) automation work.
- The `AsyncLocalStorage` cascade context is captured and re-entered across the `setImmediate` boundary, so depth/chain dedupe guards still apply to deferred runs. Do not "simplify" back to inline `await` execution.

## Conditions conjunction (AND/OR)
- Top-level conditions are combined by `conditionConjunction` (`"and"` default | `"or"`), a column on `entity_automations`. `evalConditions(list, ctx, conjunction)` short-circuits accordingly. Routes (create+update) and the UI (a selector shown only when >1 condition) carry it; `update_records_where.match` stays AND-only.

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

## Relation/lookup conditions must be pre-resolved (engine can't read them from values_json)
- Relation/lookup fields have NO value in `values_json` — their value is the linked record's projected `relatedFieldKey`, stored only in `record_links`. So the in-memory `evalCondition` cannot evaluate them unless the value is injected first.
- `loadRelationValues(entityId, recordIds, fields)` resolves entity-source relation/lookup fields into `values[fieldKey]` as a **string[]** (one entry per link), merged into the context in BOTH `runOne` (top-level conditions) and `update_records_where` (batched over all target rows — never per-row, to avoid N+1). `evalCondition` then matches with **EXISTS-any** semantics (eq=`includes`, contains=`some(substring)`, empty/notEmpty by length), matching the records-query relation filter.
- **Why:** keeps relation-condition semantics identical to view/record filters (compare the linked record's projected value, NOT a record id) and is the only way the JS engine can see relation values.
- **How to apply:** any new code that evaluates conditions over a record must run `loadRelationValues` and spread it into `values` first. Page-source projections (`relationConfigJson.relatedPageId != null`) are intentionally NOT resolved (different store the engine doesn't read) → they read as empty.
- UI: relation/lookup condition value uses `RelationValueControl` (candidate-label combobox via `useGetEntityRelatedCandidates`, free-typed values allowed); requires `ownerEntityId` threaded `ConditionsEditor → ValueControl` (page `entityId` top-level, target `entityId` for `update_records_where.match`).

## Dynamic condition value (from the triggering record)
- A condition value may be a fixed literal (`value`) OR sourced from a field of the **triggering** record (`valueSource: "field"` + `valueFieldKey`). `evalCondition` takes a `triggerValues` map and resolves `condValue` from it (collapsing a relation `string[]` to `[0]`); all comparisons use `condValue`, never `cond.value` directly.
- `evalConditions` carries `triggerValues` (defaults to the row's own `values`). For `update_records_where` it is called with the TRIGGERING `ctx.values`, so each target row's `fieldKey` is matched against the trigger record's `valueFieldKey` — this is what makes "update rows where target.X == trigger.Y" possible.
- **Validation:** `valueSource:"field"` ⇒ `valueFieldKey` must be non-empty AND exist on the automation's OWN entity (the trigger entity's `keys`), enforced in `validateSpec.checkCondition` regardless of which entity `fieldKey` targets. UI only exposes the literal/field toggle for the `update_records_where.match` editor.

## Empty-match safety gate (update_records_where)
- An `update_records_where` action with an empty `match` updates EVERY non-archived target record (`evalConditions` returns true on empty). This is intentional but dangerous, so the UI requires an explicit transient `confirmAllRecords` acknowledgement (red warning + checkbox) before save; `handleSubmit` hard-blocks the save with a destructive toast otherwise. `confirmAllRecords` is NOT persisted — re-editing an all-records automation forces re-confirmation.

## Trigger/action vocabulary
- Triggers: `record_created`, `record_updated`, `field_changed`, `status_changed`, `date_reached` (offsetDays).
- Actions: `set_field`, `change_status`, `create_record`, `update_records_where`, `webhook`.
- Conditions use a reserved status key `__status__` (mirrors the records-query convention).
- The records PUT path emits `changedFields` so `field_changed`/`status_changed` triggers can match.
