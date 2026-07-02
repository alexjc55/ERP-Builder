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
