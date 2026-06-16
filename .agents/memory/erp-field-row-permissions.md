---
name: ERP field-level & row-level permissions
description: Durable rules for the metadata ERP's per-field (hidden/view/edit) and per-row (all/own) access; the boundary decisions that must stay consistent across server and client.
---

# Field-level + row-level record permissions

The server is the hard boundary; the web client only mirrors it cosmetically. Both must
resolve access identically or the UI desyncs from what the API allows.

## Field-access fallback rule (must match server + client)
superAdmin ⇒ `edit`. An explicit per-field role entry wins. Otherwise inherit from the role's
record perms: **`create || update` ⇒ `edit`, else `view`**.
**Why:** a field with no explicit config must behave "as before" — a create-only role has to be
able to populate fields on create, an update-only role on update. Using `update` alone silently
broke create-only roles (they could open the create form but the server dropped all values, so
required fields failed). Each write endpoint stays separately gated by its own record perm, so
`create||update` for inherited edit does not widen the actual write boundary.

## Hidden fields must be non-observable, not just non-rendered
Stripping hidden keys from response bodies is not enough on its own. Every record-returning path
must strip hidden fields (including the easy-to-miss **create** and **update** write responses),
AND the query endpoint must build its filter/sort/search whitelist from **visible** fields only —
otherwise a role infers hidden values through filter/search behavior.
**Why:** review caught hidden data leaking via the update response and via query-time inference.
**How to apply:** route any new record-returning or query surface through the same access-context
+ strip-hidden + visible-only-whitelist path.

## Merge-on-write protects view-only/hidden fields
On create/update only fields the role may `edit` are taken from the request; all others keep their
stored value (update) or are dropped (create). This is what makes it safe for the client to send
view-only/hidden fields without clobbering them.

## Row scope (all/own)
`RecordPermission` carries `scope: all|own` + `scopeFieldKeys`. `own` shows rows where ANY listed
owner field designates the current user; `own` + empty `scopeFieldKeys` ⇒ **no rows** (deny, by
design — never fail-open to all). get/update/delete re-check ownership and return **404** (not 403)
for non-owned rows so existence isn't disclosed.

### Owner fields are relation-aware (one hop), not just native `user` fields
An owner field key in `scopeFieldKeys` is EITHER a native `user`-type field (ownership lives in
`values_json[key]`) OR a relation/lookup field that projects a `user`-type field one hop away
(ownership lives in record links, NOT in values_json). The single shared resolver
(`own-scope.ts`: `ownScopeWhere` for SQL list filters, `isRecordOwned` for single-record re-checks)
classifies each key and builds a native equality clause or a relation `EXISTS` clause.
**Why:** ownership designated through a relation can't be seen in `values_json`, so any site that
checked `values[key] === userId` natively was under-inclusive (silently hid owned rows) for
relation owner fields.
**How to apply:** EVERY enforcement site must go through `own-scope.ts` — both the list-filter
sites (records list/query/filter-values, page record-values/related-values/related-candidates) AND
the single-record re-checks (records update/delete/GET-by-id, page record update, related-link
base+linked checks, and file-access checks in storage/audit-log/google-drive). A native-only check
left at any one site re-opens the bypass. Never reintroduce an inline `values[key] === userId`.
The native comparison in `isRecordOwned` must be **text-based** (`String(values[key]) === String(userId)`)
to match `ownScopeWhere`'s SQL `values_json ->> key = <userId>` (the `->>` operator yields text). A
numeric (`Number(...)`) compare diverges for odd stored forms (`"01"`, `"1.0"`) so the single-record
re-check would accept a row the list filter hides — the two MUST agree exactly.

## Adding a column to entity_fields: update PUT explicitly
The fields update route builds its update object key-by-key, so a new column (e.g. `permissionsJson`)
needs an explicit assignment line in the field-update handler or updates silently drop it. Create
works because it spreads the whole parsed body.
