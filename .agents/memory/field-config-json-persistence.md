---
name: Field config JSONB persistence
description: Per-field config JSONB columns (fileConfigJson, userConfigJson, ...) must be wired into BOTH the create insert and the PUT updateData allowlist, or edits silently no-op.
---

The fields PUT route (`artifacts/api-server/src/routes/fields.ts`) builds an explicit
`updateData` allowlist — only keys it names are persisted. The create route, by contrast,
spreads `parsed.data` so new columns flow through automatically.

**Rule:** when adding a new per-field config JSONB column (e.g. `fileConfigJson`,
`userConfigJson`), you MUST also add an explicit `if ("xConfigJson" in body) updateData.xConfigJson = ...`
line to the PUT route. Otherwise creating the field works but editing it appears to succeed
(200) while the backend ignores the change.

**Why:** the create path's `...parsed.data` spread hides the gap — codegen + create + db push
all pass, the UI shows no error, but updates are dropped. This was missed once and only caught
in review.

**How to apply:** use `"key" in body` (presence check), not `body.key != null`, so an explicit
reset to `{}`/`null` persists. Mirror the field type's empty default (file → `null`, user → `{}`).

## Stale codegen silently strips the field (separate failure mode)

Even with create + PUT allowlist + DB column all correct, edits can still no-op
if `pnpm --filter @workspace/api-spec run codegen` was NOT re-run after editing
`openapi.yaml`. The server validates the request body with the generated zod
(`UpdateFieldBody` etc.); a `zod.object(...)` STRIPS unknown keys, so a config
key missing from the stale zod is dropped before `"key" in body` is ever checked.

**Why it hides:** `pnpm run typecheck` can still pass — the request *type* and the
*zod* are emitted by the same codegen run, but if a prior partial state left types
fresh and zod stale (or you only edited yaml), typecheck is not proof the runtime
validator is current. Symptom: 200 OK, no error, value never persists, DB column
stays at its default.

**How to apply:** after ANY `openapi.yaml` edit, run codegen and grep the
generated zod (`lib/api-zod/src/generated/api.ts`) for the new property before
assuming a persistence bug is in the route. Restart the API workflow so the new
zod is loaded.
