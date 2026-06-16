---
name: Object storage & file field type
description: How the "file" field type stores values and why object serving must re-apply the records permission boundary.
---

# File field type & object serving

## Value shape
A `file`-type field stores a JSONB object, not a string: `{ path: "/objects/...", name, contentType?, size? }`. `path` is a server-minted, unguessable object path from the presigned-upload flow. The server validator must reject any `path` not starting with `/objects/` and require a non-empty `name`, but that check alone does NOT establish authorization.

## Object serving authorization (hard boundary)
**Rule:** `GET /storage/objects/*` must NOT serve bytes on `requireAuth` alone. It must re-apply the records field/row/entity boundary: serve only if the requested object path is referenced by a record the caller may *view* through a *non-hidden* file field (entity read perm + row scope all/own + field access ≠ hidden).

**Why:** This mirrors the `audit-field-security` invariant — any endpoint returning stored values must re-apply the field-hidden boundary; record-level gating is not enough. Object paths are unguessable UUIDs, but treating the URL as a capability (auth-only) is an IDOR-by-path: any authenticated user (including read-only guests) who learns a path could read it, bypassing per-field/row/entity permissions. The architect review flagged exactly this.

**How to apply:** Authorize by *reference lookup* (find records whose `valuesJson` contains the path, then run the same `getPermissions`/`canRecord`/`resolveFieldAccess`/`effectiveScope`/`recordOwnedBy` checks the records routes use), NOT by uploader-ownership ACL. Uploader-only ACL is wrong here: a file attached to a record must stay viewable by *other* users who can see that record. A just-uploaded file not yet referenced by a saved record is intentionally unreadable until the record is saved.

## Display: file/url cells are always LTR, even in a Hebrew (RTL) UI
**Rule:** `url` and `file` field cells render their value (URL / link / filename) inside an `dir="ltr"` left-aligned truncating wrapper, regardless of the UI language. **Why:** these values are inherently LTR strings; in an RTL document the table cell's `truncate` puts the ellipsis at the *start* and reads the URL from its end — the user reported links showing "from the end" in Hebrew. **How to apply:** force LTR at the single shared render point (`renderCellValue` in EntityRecords), so native columns, page-field columns, and relation/lookup columns that PROJECT a url/file all inherit it; it's a visual no-op in ru/en. Do NOT push `dir` onto the `<td>` per call-site — there are many and they'd drift.
