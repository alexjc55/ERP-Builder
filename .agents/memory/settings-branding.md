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

## Global records-table display style + custom colors
- `app_settings.tableStyle` (plain/striped/striped_bold) plus three optional hex colors `tableStripeColor` + `tableHeaderColor` + `tableBorderColor` drive how EVERY records table renders platform-wide. Admin-edited on `/settings` (same `settings` cap).
- **Divider/grid line color (`tableBorderColor`):** vertical column separators are NOT in the markup — they come from a single global rule in `index.css` (`table th/td:not(:last-child) { border-right: ... }`). Filling the header with a color hides them (default `hsl(var(--border)/0.7)` has no contrast). Fix = the rule reads `var(--erp-table-border, <fallback>)`, and EntityRecords sets `--erp-table-border` as an inline CSS custom property on the records `<table>` only. CSS-var inheritance scopes the override to that table; other tables keep the fallback. Don't try to add per-cell border markup.
- **Totals strip (numericTotals row above the header):** only cells that carry an aggregate value should look highlighted. Empty totals `<th>` must blend into the page background — set `backgroundColor:"transparent"` + `border:"none"` (the inline `border:none` is what defeats the global per-cell `border-right` separator, locally, for just those cells) and pass `"transparent"` to `pinStyle` for sticky empties. Filled cells keep their fill (`totalFillColor` or emerald default) + a full box border `var(--erp-table-border, hsl(var(--border)/0.7))`; sticky filled cells must still pass an opaque bg into `pinStyle`.
- **Colors use the shared `ColorPickerControl`** (react-colorful + saved-presets palette in localStorage), NOT a native `<input type="color">`. That component is the project-wide canonical color UI (also in FieldConfigDialog, PageFieldConfigDialog, DashboardView, FieldFormatRulesEditor). Its value model is `""` = none / `#RRGGBB`; adapt singleton-null fields with `value={x ?? ""}` and save `x || null`.
- **Why a custom color UI was rejected:** the user requires identical UI elements across the whole project — always reuse the existing component, never reintroduce a native picker.
- Server `normalizeHexColor()` validates `^#[0-9a-fA-F]{6}$` (empty/null clears) → prevents CSS injection via inline `background`. Both color fields obey the GET-4space / PUT-6space duplication rule above.
- **Pinned/sticky columns gotcha:** sticky cells set their own opaque `backgroundColor` via `pinStyle()`, which OVERRIDES the row's `<tr>` background (Tailwind class or inline). So any per-row/per-header color must be passed INTO `pinStyle` too. EntityRecords resolves one `rowBgConcrete` (priority conditional rowColor → stripeColor → built-in `#f8fafc` → white) for both the `<tr>` and every body pinned cell, and one `headerBg` (headerColor ?? bold/plain default) for header pinned cells. Keep `rowBgForTr` undefined on white rows so `hover:` still works.
