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
