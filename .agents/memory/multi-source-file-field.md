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
