---
name: ERP field-level & row-level permissions
description: How the metadata ERP enforces per-field (hidden/view/edit) and per-row (all/own) access; the boundary rules that must stay in lockstep client+server.
---

# Field-level + row-level record permissions (Этап 10)

The server is the hard boundary; the web client only mirrors it cosmetically. Both must
resolve access the same way or the UI desyncs from what the API allows.

## Field access resolution (must match on both sides)
Order: superAdmin ⇒ `edit`; else explicit `field.permissionsJson[String(roleId)]` if set;
else fall back to the role's record perm for that entity — `update` ⇒ `edit`, otherwise `view`.
- Server: `resolveFieldAccess` in `middlewares/permissions.ts`.
- Client: `fieldAccess()` in `lib/auth.tsx`.
**Why:** an unset field must inherit the role's record perm so existing data stays
backward-compatible (no per-field config ⇒ behaves as before).

## Hidden fields must be non-observable, not just non-rendered
Stripping hidden keys from response bodies is NOT enough. Every record response path must
`stripHidden` (list, query, get, **create**, **update** — the write responses are easy to miss),
AND the query endpoint must build its filter/sort/search whitelist from **visible** fields only,
or a role can infer hidden values via filter/search behavior.
**Why:** a code review caught hidden data leaking through the update response and through
query-time inference. **How to apply:** when adding any new record-returning endpoint or query
surface, run it through the same `fieldAccessContext` + `stripHidden` + visible-field-whitelist path.

## Merge-on-write protects view-only/hidden fields
On create/update, only fields the role may `edit` are taken from the request; all others keep
their stored value (update) or are dropped (create). This is what makes view-only/hidden safe
to send from the client without clobbering.

## Row scope (all/own)
`RecordPermission` carries `scope: all|own` + `scopeFieldKeys: string[]` (keys of `user`-type fields).
`own` filters rows to those where ANY listed user-field equals the current user id.
`own` + empty `scopeFieldKeys` ⇒ `sql false` (no rows) by design, not a bug.
get/update/delete re-check ownership and return **404** (not 403) when a row isn't owned.

## `permissionsJson` persistence gotcha
The fields route builds `updateData` key-by-key — adding a new column to `entity_fields`
(like `permissionsJson`) requires an explicit `if (body.X != null) updateData.X = ...` line in
`PUT /fields/:id`, or updates silently drop it. Create works via `...parsed.data` spread.
