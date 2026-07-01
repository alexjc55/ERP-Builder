---
name: ERP DB-backed localization
description: How the erp-platform i18n is wired and how to keep translation seeding complete.
---

# DB-backed i18n (erp-platform)

All static UI strings live in the Postgres `translations` table — there are no locale json/yaml files. The web reads them via `useListTranslations` and resolves with `useT(key, def)`; metadata (multilingual JSONB) resolves via `useML()`. Core lives in `artifacts/erp-platform/src/lib/i18n.tsx`.

**Rule:** when you add a `t("key", "Рус")` call with a *template/dynamic key* (e.g. `t(\`fields.type.${x}\`, …)`, `roles.cap.*`, `roles.action.*`), you MUST add that key to `scripts/src/data/ui-translations.json` and re-run `pnpm --filter @workspace/scripts run seed-translations`.

**Why:** the seed script discovers keys two ways — curated entries in `ui-translations.json`, and a regex that extracts only *string-literal* `t("k","ru")` calls from source. Template-literal keys are invisible to the regex, so if they aren't in the curated JSON they never get seeded and render only their RU code default for every language.

**How to apply:** static literal `t()` calls are auto-discovered (RU fallback even if uncurated), so they're safe; only template/dynamic keys need manual curation. The seed is idempotent (`onConflictDoUpdate` on `translationKey`), so re-running is always safe.

**The literal-key audit does NOT prove "no hardcoded UI".** Verifying every `t("k",…)` key resolves in the DB only covers strings already wrapped in `t()`. It misses (a) whole screens/components that never call `t()` at all (e.g. the Translations admin page once shipped fully hard-coded Russian), and (b) template/dynamic keys that were referenced but never seeded (`fields.op.*`, formula function `descKey`/`sigKey`, audit reserved labels). To actually answer "are there untranslated phrases anywhere", run a raw-Cyrillic sweep over `*.ts/*.tsx`, then triage the hits: comments, swallowed parser `throw` messages (never surfaced), multi-line `t(key, "fallback")` second args, and language-intrinsic editor labels/placeholders (the RU/EN/HE input fields, endonyms like "Русский") are all acceptable; anything else rendered in JSX/`title=`/`placeholder=`/toast must be wrapped.

**Login page is RU by design:** `useListTranslations` is enabled only when logged in, so pre-auth screens fall back to the code default (RU). Don't "fix" this by enabling the query for anonymous users unless that's actually wanted.

**Direction/override:** the I18nProvider owns `document.documentElement.dir/lang` (he ⇒ rtl) — auth must not also set direction or they fight. `setLang` sets a transient override, persists via `PUT /auth/me`, sequence-tags the write so stale responses can't win, rolls back on error, and clears the override on logout.

## RTL (Hebrew) flips pointer-geometry interactions

Any mouse/pointer interaction whose math assumes left-to-right breaks under
Hebrew (`lang === "he"`), because the app sets `document.documentElement.dir =
"rtl"` and the whole layout mirrors. The records table column-resize is the known
case: the drag handle must sit on the column's logical END edge (`right` in LTR,
`left` in RTL) AND the width delta must invert (`clientX - startX` in LTR,
`startX - clientX` in RTL). Detect via `useLang()` → `lang === "he"`. When adding
new drag/resize/swipe affordances, account for both the handle side and the delta
sign in RTL.

## RTL: physical Tailwind classes silently break mirroring

Static physical-direction utilities (`text-left`/`text-right`, `pl-*`/`pr-*`,
`ml-auto`/`mr-auto`, and inline `left`/`right`) do NOT flip under `dir="rtl"`, so
an element stays pinned to the wrong edge while everything around it mirrors. Seen
repeatedly: a sidebar menu-group header stuck left in Hebrew (`text-left`), the
calendar card border/alignment, the records search icon. Always use logical
equivalents (`text-start`/`text-end`, `ps-*`/`pe-*`, `ms-auto`/`me-auto`,
`border-s`/`border-e`, `borderInlineStart`). When touching any layout, grep the
component for physical classes before assuming RTL "just works".

## Radix RTL: DirectionProvider AND a single react-direction copy

Radix UI primitives (Select, Dropdown, Popover, Tooltip, etc.) read text
direction from the `@radix-ui/react-direction` `DirectionProvider` context, NOT
from `document.documentElement.dir`, and they actively STAMP `dir="..."` onto
their own trigger/content elements (`dir: context.dir`, defaulting to `"ltr"`).
That stamped `dir="ltr"` overrides the `rtl` the element would otherwise inherit
from `<html dir="rtl">` — so in Hebrew the Select trigger renders LTR (value
left, chevron right, text clipped on the wrong side) even though the rest of the
page is correctly RTL. The app wraps everything in
`<DirectionProvider dir={dirFor(lang)}>` (in `App.tsx`, INSIDE `I18nProvider` so
`useLang()` is available; reuse the exported `dirFor`, don't re-derive).

**The provider only works if it is the SAME module instance the Radix component
consumes.** pnpm can install two copies of `@radix-ui/react-direction` (e.g. a
deduped `1.1.1` pulled by `react-select` + a `1.1.2` from an artifact's direct
dependency). Two copies = two distinct React context objects, so the provider is
invisible to the consumer and silently does nothing. Fix = pin one version via a
`pnpm-workspace.yaml` override (`'@radix-ui/react-direction': <version>`) so
provider and all Radix packages share one context, then `pnpm install` + restart
the web workflow so Vite re-bundles.

**Why:** symptom was the records-table Status `Select` in Hebrew — field/text
clipped, can't scroll, everything left-aligned. Adding the DirectionProvider
alone did NOT fix it because the provider's copy differed from react-select's
copy; the visible LTR layout was Radix stamping its default `dir="ltr"`.

**How to apply:** for any Radix RTL bug, first verify there is exactly ONE
installed copy of `@radix-ui/react-direction` (check the `.pnpm` symlinks of the
consuming package AND the artifact). Never assume `document.dir` or the provider
alone is enough. Watch for the same duplicate-context trap with other shared
Radix context packages.
