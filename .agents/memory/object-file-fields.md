---
name: Object storage & file field type
description: How the "file" field type stores values and why object serving must re-apply the records permission boundary.
---

# File field type & object serving

## Value shape
A `file`-type field stores a JSONB object, not a string: `{ path, name, contentType?, size? }`. `path` is a server-minted, unguessable path. Two path schemes coexist and BOTH are valid `server`-kind values:
- `/objects/...` — legacy Replit Object Storage (presigned-upload flow). Never migrated; still readable/writable.
- `/local/...` — LOCAL disk storage (current default for new uploads). Maps to `${UPLOADS_ROOT}/<rel>` (env `UPLOADS_DIR`, default repo-root `uploads/`). Record files land at `/local/files/<storageDir>/<uuid>__name`, branding logo at `/local/branding/<uuid>__name`.

The server validator must accept a `path` starting with EITHER `/objects/` OR `/local/` and require a non-empty `name`, but that check alone does NOT establish authorization.

## Local disk storage (server uploads)
New `server`-kind uploads go to local disk, not Object Storage. Key invariants:
- **Raw upload endpoints bypass OpenAPI/Orval** (binary bodies): `POST /storage/local/upload` (record files; folder via `X-Local-Folder-Id` header, name via `X-File-Name`) and `POST /settings/logo` (branding). Both are `express.raw` under `requireAuth` — being POST, the guest read-only guard already blocks guests. The client calls them via manual `fetch` with the bearer from localStorage, NOT generated hooks.
- **Path traversal is a hard boundary.** `resolveDiskPath()` must reject anything not prefixed `/local/`, reject `\0`, and confirm the resolved absolute path stays within `UPLOADS_ROOT` (reject escapes). Never join a client string onto the root without this.
- **Local serving re-applies the SAME records boundary as object serving.** `GET /storage/local/*path` reuses `canReadObjectPath()` (entity view + row own/all + field-hidden), identical to `/storage/objects/*`. If the records permission model changes, both must change in lockstep. `GET /storage/branding-logo` branches on `isLocalPath` (local path served publicly — path comes from DB, not user input → no IDOR).
- **Folders are organizational UX, not an access boundary.** Managed local folders (`local_folders` table) mirror the Drive-folder model: nested via self-ref `parentId` (cascade), stable opaque `storageDir` UUID on disk that survives rename (rename is DB-only). A file field binds via `fileConfigJson.localFolderId`; upload sends it as `X-Local-Folder-Id`, server validates against the managed table and falls back to default. Managed via an ADMIN screen inside `/settings` gated by the `settings` cap — NOT a module.
- **Single-default invariant is DB-enforced** (partial unique index on `is_default=true`), so a concurrent first-upload race can't create two defaults; `ensureDefaultLocalFolder` catches the unique violation and re-reads the winner.
- **Deleting a local folder drops only the DB row** (+ descendant rows via cascade); physical files on disk are never auto-deleted (consistent with the Drive-folder rule). Fields bound to a removed folder fall back to default at upload time.
- **File trash / physical delete branches on scheme.** `deletePhysical()` checks `isLocalPath` (unlink from disk) vs object-storage delete; applied on serve/purge/delete in the trash flow.
- **.gitignore is SELECTIVE:** `uploads/branding/` (logo) is committed (ships with the app, `.gitkeep` present); `uploads/files/` (record file data + trash) is user data and is NOT committed.

## Object serving authorization (hard boundary)
**Rule:** `GET /storage/objects/*` must NOT serve bytes on `requireAuth` alone. It must re-apply the records field/row/entity boundary: serve only if the requested object path is referenced by a record the caller may *view* through a *non-hidden* file field (entity read perm + row scope all/own + field access ≠ hidden).

**Why:** This mirrors the `audit-field-security` invariant — any endpoint returning stored values must re-apply the field-hidden boundary; record-level gating is not enough. Object paths are unguessable UUIDs, but treating the URL as a capability (auth-only) is an IDOR-by-path: any authenticated user (including read-only guests) who learns a path could read it, bypassing per-field/row/entity permissions. The architect review flagged exactly this.

**How to apply:** Authorize by *reference lookup* (find records whose `valuesJson` contains the path, then run the same `getPermissions`/`canRecord`/`resolveFieldAccess`/`effectiveScope`/`recordOwnedBy` checks the records routes use), NOT by uploader-ownership ACL. Uploader-only ACL is wrong here: a file attached to a record must stay viewable by *other* users who can see that record. A just-uploaded file not yet referenced by a saved record is intentionally unreadable until the record is saved.

## Display: file/url cells are always LTR, even in a Hebrew (RTL) UI
**Rule:** `url` and `file` field cells render their value (URL / link / filename) inside an `dir="ltr"` left-aligned truncating wrapper, regardless of the UI language. **Why:** these values are inherently LTR strings; in an RTL document the table cell's `truncate` puts the ellipsis at the *start* and reads the URL from its end — the user reported links showing "from the end" in Hebrew. **How to apply:** force LTR at the single shared render point (`renderCellValue` in EntityRecords), so native columns, page-field columns, and relation/lookup columns that PROJECT a url/file all inherit it; it's a visual no-op in ru/en. Do NOT push `dir` onto the `<td>` per call-site — there are many and they'd drift.
