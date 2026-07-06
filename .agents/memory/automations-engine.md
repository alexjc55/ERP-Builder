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

**Frontend restriction:** the UI only offers the page-target toggle when
`update_records_where && targetId === currentEntityId` (so the automation-entity
`mirrorPages` list is exactly the target entity's mirror pages). Cross-entity page
targets are valid server-side but not surfaced in the UI (would need loading the
target entity's mirror pages).
