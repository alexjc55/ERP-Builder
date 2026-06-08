---
name: System key auto-generation
description: Convention — every creation form with a "Системный ключ" input must auto-generate the key client-side when left empty.
---

# System key auto-generation

Every admin creation form that has a "Системный ключ" (system key) input must
auto-generate a valid, unique key when the user leaves the field empty, instead
of forcing them to type one.

**The convention (client-side, in `erp-platform`):**
- Use `slugifyKey` + `uniqueKey` from `@/lib/keys`.
- Resolve at submit time: `key.trim() || uniqueKey(slugifyKey(nameForKey) || <prefix>, existingKeys)`.
- `nameForKey` = `(nameJson.en || nameJson.ru || nameJson.he || "")` — derives the base from the entered name (Cyrillic is transliterated by `slugifyKey`).
- `<prefix>` fallback guarantees a valid key when the name yields nothing (e.g. Hebrew-only or empty name): `entity`/`field`/`status`/`view`/`relation`/`module`.
- `existingKeys` = the in-scope list of current keys (per-entity for fields/statuses/views/relations; global for entities/modules), excluding the row being edited (`id !== editing?.id`). `uniqueKey` appends `_2`, `_3`, … on collision.
- Placeholder uses `*.keyAutoPlaceholder`, hint uses `*.keyHintAuto` (seeded ru/en/he in `scripts/src/data/ui-translations.json`; reseed via `pnpm --filter @workspace/scripts run seed-translations`).

**Why:** users kept hitting required/format errors on a field they don't care about. The DB enforces uniqueness and the server still validates format + returns 409 on dup, so this is purely a UX convenience layer — no contract/server change needed.

**How to apply:** any NEW creation form with a system-key field must follow this. Forms already covered: entities, entity-fields, page-fields (FieldConfigDialog/PageFieldConfigDialog), entity-statuses, entity-views, entity-relations, modules (modules: create-branch only; key is immutable on edit).
