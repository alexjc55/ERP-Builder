---
name: Multi-source file field
description: How the "file" field type supports server upload / Google Drive / pasted link, and the invariants that must stay consistent.
---

# Multi-source file field

The `file` field type is polymorphic at fill time: a value is one of three kinds —
`server` (object-storage upload), `gdrive` (managed Google Drive upload), or
`link` (pasted external URL). Admins opt into which sources a given field allows
via `fileConfigJson.allowedSources` on the field; the default is server-only.

## Invariants (must stay consistent)

- **Back-compat is sacred.** A legacy stored file value has no `kind` and has a
  `path` → it MUST be treated as `server`. Never migrate or break stored rows.
- **Validation is server-side and per-kind.** The records write path validates the
  value shape against its `kind`, enforces the field's `allowedSources`, and
  restricts `link` URLs to `http`/`https` only. Client config is cosmetic.
- **Managed Drive files are reference-based** (stored as a Drive `fileId`, not bytes).
  Reads go through a server proxy that re-applies the records read boundary —
  entity `view` permission + per-row `own` scope + the field-hidden check — before
  streaming bytes. The proxy mirrors the existing object-storage boundary; if the
  records permission model changes, this proxy must change in lockstep.
- **Drive write/admin endpoints are POST**, so the `requireAuth` guest read-only
  guard already blocks guest tokens from uploading or changing the connection.
- **Google Drive is a toggleable Module**, not a standalone admin screen. It lives
  as a row in the `modules` registry (`module_key='google_drive'`), is a *system*
  module (delete is blocked server-side), and its config page is reached via the
  module's "Настройки" button — it is intentionally absent from the sidebar.
  `GET /google-drive/status` returns `enabled`; `isGoogleDriveModuleEnabled()`
  defaults to **true when the row is missing** (graceful in a fresh deploy where the
  data row hasn't been seeded). Disabling is therefore always explicit.
- **Module-off is a hard write boundary, not a read boundary.** When the module is
  off, new/changed `gdrive` values are rejected on the records write path and the
  upload endpoint returns 403, but an *unchanged* previously-stored `gdrive` value
  (same `fileId`) must pass validation so unrelated edits to the same record still
  succeed and existing Drive files stay readable. The records update path
  re-validates the whole merged row, so this prev-value exemption is what prevents
  module-off from blocking ordinary edits on records that already hold a gdrive file.

## Google Drive connection

- Single-row connection table (`DRIVE_CONNECTION_ID = 1`). Scope is `drive.file`
  only (works with free Gmail; only sees files the app created).
- Two key modes: `builtin` (creds from env `GOOGLE_OAUTH_CLIENT_ID/SECRET`) and
  `own` (admin-supplied creds). `builtinCredsAvailable()` checks env; when absent,
  own-keys is the only path. Own client secret + the OAuth refresh token are stored
  AES-256-GCM encrypted (see `crypto.ts`).
- OAuth `state` is a short-lived signed JWT carrying a fixed purpose; the callback
  verifies signature + purpose before exchanging the code.

**Deviation from original plan:** uploads land in an auto-created Drive folder
("ERP Uploads") instead of a Google Picker folder chooser. Picker was descoped.

## Two field editors must stay in sync

There are **two** field-editor UIs and they each carry their own copy of the
`FIELD_TYPES` list and the file-config (allowedSources) block: the dedicated
Fields page (`entity-fields.tsx`) and the inline dialog used in the records
table (`FieldConfigDialog.tsx`). Adding a field type / config to one but not the
other is a silent gap — the `file` type was originally only added to the inline
dialog, so admins on the Fields page couldn't create file fields at all. Any new
field type or per-type config must be mirrored in BOTH.

**i18n key prefix gotcha:** both editors reference the file-source labels under
`fields.fileSource.{server,gdrive,link}` (and `fields.type.file`), but the seed
originally only had `records.fileSource.*`. `t(key, default)` falls back to the
Russian default, so a missing key shows untranslated in en/he rather than erroring.
When adding type/source labels, seed the `fields.*`-prefixed keys, not just `records.*`.

## File hover-preview in the records table

The records-table file cell shows an auth-gated hover preview: images inline,
PDFs in an `<iframe>` fed a blob object URL. A raw PDF blob renders the browser's
**native** PDF viewer (toolbar + side "Layers"/thumbnail panel), which overflows
a small hover card and covers adjacent UI. Always append
`#toolbar=0&navpanes=0&view=FitH` to a PDF blob/file iframe src so only the page
renders. Do NOT add these params to the Google Drive embed preview (link cells) —
that uses Google's own clean embed and is unaffected; gate the params on the
preview kind being `pdf`.

## Managed Drive folders (per-field upload target)

gdrive uploads can target one of several admin-managed folders (`google_drive_folders`),
each app-created so the narrow `drive.file` scope is preserved (the app only ever
sees folders it created). A file field binds to one via `fileConfigJson.driveFolderId`;
the client sends it as the `X-Drive-Folder-Id` upload header; the server validates
the header against the managed-folders table and otherwise falls back to the
connection's default folder (`conn.folderId`).

**Folder choice is organizational UX, not an access boundary.** All managed folders
live in the *same* connected admin Drive account, so a tampered header can only
move a file between admin folders — no IDOR (header is validated against the managed
list) and no data exposure. Do not over-engineer this into server-resolved-from-field
unless folder choice ever becomes a real policy.

**Single-default invariant:** exactly one row is `isDefault=true` (the auto-created
"ERP Uploads"). The OAuth connect path must demote any existing default
(`set isDefault=false where isDefault=true`) *before* upserting the new default,
or a rotated Drive folder leaves two undeletable defaults (the delete route blocks
removing a default). Deleting a managed folder only drops our DB row — the Drive
folder is never deleted (consistent with "platform never deletes Drive content");
fields bound to a removed folder fall back to default at upload time.

**Subfolders (nesting):** managed folders form a tree via a nullable self-ref
`parentId` (onDelete cascade). A subfolder is created with the *parent's* Drive id
passed as `parents[]`, and the create route must validate that `parentId` resolves
to an existing managed-folder row (never trust a raw Drive id from the client).
Deleting a folder relies on the DB cascade to drop descendant rows too — the Drive
folders themselves are still never deleted. Both the admin folder manager and the
field-config folder dropdown render the same depth-flattened tree (DFS from null).

## Fast gdrive hover previews (thumbnails)

gdrive uploaded-file hover previews load Google's pre-rendered **thumbnail** (small,
fast) before the full bytes. The thumbnail is served by its own auth-gated proxy
route that re-applies the *same* `canReadDriveFile` boundary as the content proxy —
the thumbnail is NOT a public share link (that approach was explicitly rejected),
so the permission boundary is preserved. The route returns **404 when no thumbnail
exists** so the client can fall back to the full-content preview.

Client invariant: the thumbnail is always an **image** (even for PDFs), so render it
as `<img>` regardless of file type, and fall back to the full `BlobPreview` on
*both* fetch rejection AND `<img>` `onError` (a 200 with a broken payload must still
fall back). Revoke the thumbnail blob URL on the error path before falling back.
