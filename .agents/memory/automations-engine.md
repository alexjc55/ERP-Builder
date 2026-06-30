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
