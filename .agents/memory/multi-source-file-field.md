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
