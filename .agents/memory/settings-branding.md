---
name: Settings & branding
description: How platform branding (app name/subtitle/logo) and the user profile settings page are wired, and the public-logo security model.
---

# Settings & branding

The "Настройки" dropdown item opens `/settings` (auth-only ProtectedRoute, NOT an `/admin/*` path). Two sections:
- **Profile** — any authed user edits own firstName/lastName (`PUT /auth/me`) + change password. Name save updates the `getMe` cache directly so the sidebar user block refreshes immediately.
- **Branding** — admin-only, gated by RBAC cap `settings`. Edits app name + subtitle (multilingual JSONB) + logo.

## Singleton + boundary rules
- `app_settings` is a **singleton** row (id default 1), upserted by `PUT /settings`.
- `GET /settings` is `requireAuth` only — every authed user reads it because the sidebar header (name/subtitle/logo) is built from it. `PUT /settings` is the hard admin boundary (`requireAdmin("settings")`, superAdmin bypasses).
- **Why:** branding must render for all users, but only admins may change it. Splitting read vs write at the middleware is the boundary; do not gate GET behind the cap.

## Public logo serving (no IDOR)
- Logo is uploaded via the normal presigned-URL flow into the private object dir; only the resulting object path is stored in `app_settings.logoObjectPath`.
- Served PUBLICLY at `GET /storage/branding-logo` (no auth) — branding can appear pre-auth.
- **Why this is safe:** the object path comes from the DB (admin-set), never from request input, so a caller cannot point it at arbitrary objects. `getObjectEntityFile` additionally rejects non-`/objects/` paths.
- **How to apply:** the sidebar references `/api/storage/branding-logo?v=<updatedAt>` (cache-bust). After a branding save, invalidate the `getSettings` query key so the shared layout refreshes.

## Platform default language
- `app_settings.defaultLanguage` (ru/en/he) is the org-wide default UI language. Returned by GET /settings (auth-only) so any consumer can read it, written by PUT /settings (admin cap).
- **CRITICAL constraint:** `users.language`/`users.direction` are `NOT NULL DEFAULT 'ru'/'ltr'`, so `user.language` is *never null* — the i18n active-language fallback `override ?? user.language ?? settings.defaultLanguage ?? "ru"` means defaultLanguage **never wins for an existing user**. Setting the default has NO effect on anyone already created. Don't expect the admin's own UI to switch when they change the default.
- **Where the default actually takes effect:** (1) new users inherit it at creation (don't rely on the DB "ru" column default — every create path must resolve the platform default explicitly); (2) multilingual content entry leads with + opens on the default language (primary-language-first) — the visible signal that the default changed.
- **Why:** users were confused that toggling the default did nothing visible; the dead i18n fallback was the cause. The two surfaces above make it observable and meaningful without overriding a user's explicit per-user choice (the language switcher).
- **How to apply:** any new singleton-settings field must be returned by BOTH the GET and PUT response objects in `settings.ts` — they are duplicated with *different indentation* (GET 4-space, PUT 6-space), so a single `replace_all` will silently miss one. Verify both.

Adding the `settings` cap followed the `admin-cap-stage-pattern.md` recipe (schema RoleAdminCaps + NO_ACCESS_PERMS, OpenAPI RoleAdminCaps, roles-editor label + local default-perms, but NO sidebar `/admin/*` route since settings lives at `/settings`).
