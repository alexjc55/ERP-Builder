---
name: ERP DB-backed localization
description: How the erp-platform i18n is wired and how to keep translation seeding complete.
---

# DB-backed i18n (erp-platform)

All static UI strings live in the Postgres `translations` table — there are no locale json/yaml files. The web reads them via `useListTranslations` and resolves with `useT(key, def)`; metadata (multilingual JSONB) resolves via `useML()`. Core lives in `artifacts/erp-platform/src/lib/i18n.tsx`.

**Rule:** when you add a `t("key", "Рус")` call with a *template/dynamic key* (e.g. `t(\`fields.type.${x}\`, …)`, `roles.cap.*`, `roles.action.*`), you MUST add that key to `scripts/src/data/ui-translations.json` and re-run `pnpm --filter @workspace/scripts run seed-translations`.

**Why:** the seed script discovers keys two ways — curated entries in `ui-translations.json`, and a regex that extracts only *string-literal* `t("k","ru")` calls from source. Template-literal keys are invisible to the regex, so if they aren't in the curated JSON they never get seeded and render only their RU code default for every language.

**How to apply:** static literal `t()` calls are auto-discovered (RU fallback even if uncurated), so they're safe; only template/dynamic keys need manual curation. The seed is idempotent (`onConflictDoUpdate` on `translationKey`), so re-running is always safe.

**Login page is RU by design:** `useListTranslations` is enabled only when logged in, so pre-auth screens fall back to the code default (RU). Don't "fix" this by enabling the query for anonymous users unless that's actually wanted.

**Direction/override:** the I18nProvider owns `document.documentElement.dir/lang` (he ⇒ rtl) — auth must not also set direction or they fight. `setLang` sets a transient override, persists via `PUT /auth/me`, sequence-tags the write so stale responses can't win, rolls back on error, and clears the override on logout.
