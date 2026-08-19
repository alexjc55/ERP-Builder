---
name: Automations engine — contract source of truth & combined mapping
description: Where automation trigger/condition/action/mapping types live, and how the combined value mode resolves.
---

## Contract dual source of truth (gotcha)

Automation trigger/condition/action/**mapping** types are defined as **zod schemas
in `lib/db/src/schema/automations.ts`** and consumed server-side via
`@workspace/db` (e.g. `type AutomationMapping`). `lib/api-spec/openapi.yaml` holds a
**parallel copy** of the same shapes used only for client codegen (orval → api-zod /
api-client-react).

**Why:** the server validates/typechecks against the db zod types, NOT the
OpenAPI-generated ones. Editing only `openapi.yaml` runs codegen fine but leaves the
server type unchanged → a misleading "no overlap" TS2367 at the new branch.

**How to apply:** any change to an automation mapping/condition/action/trigger shape
must edit BOTH `automations.ts` (zod enum/fields) and `openapi.yaml`, then
`pnpm run typecheck:libs` to rebuild lib declarations before the server typecheck.

## System write path parity

`systemUpdateRecord` (the AS-SYSTEM write used by set_field / update_records_where)
must mirror the HTTP records-update pipeline except RBAC/transition checks. That
includes the `lockAfterCreate` immutable-field guard on FINAL values — automations
must NOT be able to rewrite immutable fields. Any new record-write guard added to
the HTTP path must be replicated here.

## Date-trigger idempotency (scheduler)

The `date_reached` sweep claims a run row (partial-unique `dedupeKey`
`(automationId, recordId, dedupeKey)`), then executes and **upserts the final
outcome ONTO the claim row** (writeRun does `onConflictDoUpdate` when dedupeKey is
non-null) — exactly one durable row per (automation, record, due instant), and a
lost-claim conflict on a later sweep means "already fired, skip". Never let the
outcome land on a second dedupe-less row: it splits the history and a crash between
claim and run would leave a bare `{claimed:true}` marker with no outcome.

Gotcha when testing by hand: `safeConditions` silently returns `[]` on ANY schema
mismatch (e.g. operator "equals" instead of "eq") → automation runs unconditionally.

## Mapping value modes (create_record / update_records_where)

`AutomationMapping.sourceType` ∈ `literal | field | combined`:
- `field` → copy the triggering record's `sourceFieldKey` raw value.
- `combined` → `value` is a text template with `{fieldKey}` + `{__status__}`
  placeholders, interpolated against the **triggering record's display values**
  (status → status name, user → name/email, arrays → join ", "). Select values are
  plain strings, so they render as-is.

**Invariant:** combined (like `field`) always resolves against the TRIGGER record
(`ctx.entityId/values/statusId`), never the target rows in `update_records_where`.
`buildMappedValues` is async because combined lazily loads status/user names.

The combined editor reuses `FormulaEditor` with `hideFunctions` (it is plain string
interpolation, not arithmetic) and a synthetic `{__status__}` field chip.

## Page-local fields in automations (mirror pages)

Page-local fields live only on MIRROR pages (`pages.mirrorEntityId === automation.entityId`).
The automations engine supports them in 4 spots + a new internal event
(`page_value_changed` → trigger `page_field_changed`): trigger, TOP-LEVEL conditions
(never `update_records_where.match`), `set_field` target, and mapping source
(`sourceType:"field"` only). Client passes page values as RAW strings (no coerce) —
the server coerces at compare time and `validatePageValues` coerces on write.

**Runtime hard boundary (fail closed):** an AS-SYSTEM write to a page field
(`systemSetPageValue`) must RE-VERIFY at run time that the target page is still a
mirror page of the automation's entity (`page.mirrorEntityId === entityId`), not
trust the stored `targetPageId`. Metadata drifts (page retyped, mirror re-pointed,
deleted) after the automation was saved; save-time validation in `validateSpec` is
not enough. Same principle applies to any future system write that resolves a
metadata ref captured earlier.

## Writer-side freshness after event automations

Event automations are dispatched asynchronously after the initiating HTTP write
has already responded. A client refetch performed only in the mutation's immediate
success handler can therefore race the automation and render the old value until
another action or a full reload.

**Why:** This was visible on a mirror page where changing one page-local select
triggered a same-record automation that populated another page-local number: the
first refetch completed before the automation write, so the following edit appeared
to reveal the previous row's result.

**How to apply:** A writer UI that must show automation side effects should keep its
immediate refresh, then perform bounded delayed refreshes (or use a completion/realtime
signal). In the records table, invalidate BOTH entity-record data and current-page
record-values because an automation may write either storage channel. Never let a
rapid second edit cancel the first edit's remaining refresh opportunity.

## Create-event ordering with relation links

Entity relation selections from the record-create UI are persisted after the base
record exists, through the related-link endpoint. Therefore `record_created` fires
before those links exist; a create automation that reads a relation/lookup as a
dynamic condition or match value sees it as empty and may report a successful
no-op.

**Why:** A Delivery→Orders rule matched Orders.order_number against the new
Delivery record's relation projection. The automation ran about 140 ms before the
record link was inserted, so it matched zero target rows while logging `ok:true`.

**How to apply:** Keep create-only business rules on `record_created`; do not
substitute `record_updated`, because unrelated later edits would retrigger them.
The creation flow must give relation-dependent rules the creation-time relationship
state while preserving exactly one create-event execution. Ordinary link or field
updates must not substitute for creation. Action diagnostics should include the
matched-row count so a zero-match no-op is visible.

## Page-TARGET mappings (update_records_where → sibling page-field propagation)

A mapping can also WRITE to a page-local field (`targetFieldSource:"page"` +
`targetPageId`), honored ONLY by `update_records_where` (create_record has no
existing records to attach page values to → rejected). Use case: a
`page_field_changed` trigger propagates the changed page value to sibling records of
the same group (matched by e.g. an `order_number` relation) by writing the SAME page
field on each matched record.

**Target boundary differs from source boundary.** A page SOURCE
(`sourceFieldSource:"page"`) mirrors the *automation's own* entity. A page TARGET
must mirror the ACTION's `targetEntityId`, which may differ from the automation
entity. So `validateSpec` resolves target mirror pages with a SEPARATE per-target-
entity cache (`targetMirrorPageIds`/`checkTargetPageRef`) — never reuse the
automation-entity `mirrorPageIds` set for target validation.

**How the engine applies it:** mappings are bucketed — entity-field values →
`systemUpdateRecord` (skipped when empty), page-target writes → `systemSetPageValue`
per matched row, passing `action.targetEntityId` (which re-verifies the mirror
boundary at run time). Convergence relies on `systemSetPageValue` only emitting its
change event on an ACTUAL diff (a sibling already holding the value writes nothing →
no re-trigger), plus the existing ALS depth/chain guards.

**Mapping-loop gotcha:** when `targetFieldSource==="page"`, SKIP the entity-field
`targetKeys.has(targetFieldKey)` check — the target key is a page-field key, not an
entity field, so the entity check would wrongly reject it.

**Frontend boundary:** page-target options must be derived from the ACTION's target
entity, not from the automation entity. Cross-entity page targets are valid and
must remain visibly editable; while page metadata loads, never reinterpret an
existing page-target mapping as an entity-field mapping.

**Orphan-key fail-close (metadata drift):** `systemSetPageValue` merges the new
value onto the stored page-values map and re-validates the WHOLE map with
`validatePageValues`, which REJECTS any unknown key. A page field deleted/renamed
after values were stored leaves orphan keys behind, so a sibling still carrying a
stale key would fail the cascade write (`ok:false`) even though the automation isn't
touching that key — symptom: automation fires but nothing propagates, run status
`error`, log `systemSetPageValue: validation failed / Unknown page field: <key>`.
Fix: strip the stored map to currently-active page-field keys before merge+validate;
orphans then self-heal (dropped on the next system write). The manual HTTP PUT path
hides this because it validates only the incoming payload, which never carries the
orphan.

**Required fields on system writes:** systemUpdateRecord enforces required-ness ONLY for the keys the automation itself sets (validateValues optional `requiredOnlyKeys`). Pre-existing empty required fields (legacy imports) must not block unrelated automation updates; user-facing PUT/POST and systemCreateRecord stay strict. Explicitly clearing a required key is still blocked.

## Formula sources & "this record" match

- Mapping `sourceType:"field"` now computes FUNCTION (formula) source fields on the fly via `buildFormulaScope` (`formulaDefsOf` in automations-engine.ts) — entity fields and page-local fields alike (page scope = entity values + page values + formula defs from both sides). Relation/lookup stay fail-closed. Validation/UI allow function only as a READ source (`readableOnly` in PageFieldSelect), never as a write target. Combined templates still do NOT compute formulas (display map reads stored values only).
- Special `update_records_where` match key `__record_id__` (`CONDITION_RECORD_ID_KEY`): candidate row id vs the TRIGGERING record id, eq/neq only, no value stored; validated to own-entity targets. This is how an automation updates "the same record" (incl. its page fields) without needing a unique key field.
- Execution order: automations run per event ordered by (sortOrder, id) — id tiebreak is MANDATORY. Ties at sortOrder=0 previously got arbitrary pg order, so a later-created field_changed rule could run before a record_updated rule that overwrites the same target field, silently "breaking" old automations.
- update_records_where and the date_reached sweep INCLUDE archived rows (user decision, Aug 2026): automations must keep data consistent even for records already swept to archive. Previously archived rows were skipped, causing "automation didn't fire" reports.
