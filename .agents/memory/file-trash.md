---
name: File trash (recycle bin)
description: How deleted LOCAL record files become recoverable, and the boundaries that must stay consistent.
---

# File Trash (корзина файлов)

A recycle bin for LOCAL (object-storage) files removed from records. Backed by the
`deleted_files` table. A row is created when a record is deleted or a file field is
cleared/replaced; the physical object is kept until the entry is purged.

## Boundaries / invariants (keep consistent)

- **Only LOCAL files are tracked or ever physically deleted.** Google Drive (`fileId`)
  and pasted-link (`url`) file values are never trashed and never deleted. Detection is
  `asServerFile()` in `records.ts`: `kind === "server"`, or legacy kind-less value whose
  `path` starts with `/objects/`.
  **Why:** the platform never owns/deletes Drive files; links are external.

- **Trash recording is best-effort and must never block or roll back the record op.**
  `trashRemovedServerFiles()` swallows its own errors. A failure to log a removed file
  into trash must not fail the user's delete/update.
  **Why:** explicit product decision — recovery is a nice-to-have, data ops are not held
  hostage by recycle-bin bookkeeping. Do NOT "fix" this by wrapping it in the record
  transaction.

- **Trash screen + all `/deleted-files` endpoints are superAdmin-only** (`requireSuperAdmin`
  server-side; `ProtectedRoute superAdminOnly` + sidebar page row has no admin-cap mapping
  so `isPageVisible` shows it only to superAdmin). Listing exposes file metadata across all
  entities, bypassing the per-record boundary — so it must not be broader than superAdmin.

- **Restore = download only.** "Восстановить" never re-attaches the file to a record; it
  downloads the bytes (origin entity/field/record/who/when are shown for context).

- **Purge / single-delete drop the DB row only after the physical object is gone.** Single
  delete returns 500 and keeps the row on storage failure; purge-all deletes only the rows
  whose object delete succeeded. `objectStorage.deleteObjectEntity` ignores not-found.
  **Why:** a transient storage failure must stay retryable, not orphan a blob with no
  reference row.

## Convention note

The download endpoint `GET /deleted-files/:id/content` is intentionally NOT in OpenAPI —
it follows the same raw-`fetch` + bearer-token pattern as all other auth-gated binary
serving (`/storage/objects/*`, `/storage/branding-logo`, gdrive `/files/:id/content`).
Orval binary clients are awkward; staying consistent with the existing precedent.
