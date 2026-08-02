---
name: Filter row scope (по значению поля)
description: Third record scope "filter" — role sees only rows where a field's value is in a configured set; encoding trick reusing the own-scope pipeline.
---

# "filter" row scope

A role's `RecordPermission` can set `scope: "filter"` + `scopeFilters: [{fieldKey, values}]`. Hard server boundary on reads AND writes (unlike SOFT page default quick-filters, which the user can reset).

## The encoding trick (keep it)
`effectiveScope`/`effectiveScopeFor` (permissions.ts, via `resolveScopeEntry`) report scope as **"own"** and encode each condition as a synthetic scopeFieldKeys entry `__valfilter__:{"k":fieldKey,"v":[...]}` (`lib/scope-filter.ts`). All ~30 existing `scope === "own"` enforcement sites therefore apply it with ZERO per-site changes. `own-scope.ts` decodes; the encoded form NEVER leaves the server (merged perms sent to client keep structured `scopeFilters`).

## Semantics
- Conditions OR across entries and across roles (most-permissive union in `mergeRecordPerms`; filters concat only from view-granting roles; any role with scope all → all; any "own" or filterless view role → plain own behavior wins per merge rules).
- "filter" with empty/no conditions = deny all (safe default). NULL values never match.
- Native fields: SQL `values_json ->> key IN (...)`, in-memory re-check via String compare — must stay in parity.
- Relation/**lookup** fields ARE supported: EXISTS via `relationValueExists(meta, v IN values)` (exported from record-query.ts) — values compared against the LINKED record's projected `relatedFieldKey` (e.g. Покрасчик on Изделия is a lookup to Заказы.painter). isRecordOwned runs the same EXISTS scoped to the record id.
- function/file fields excluded in UI candidates.

## UI (roles.tsx)
Scope select gains «По значению поля»; `ScopeFilterEditor` (v1 single condition = scopeFilters[0]); select fields → option-value checkboxes (stored option VALUE, not label); lookup/relation → `ScopeFilterRelatedValues` loads related entity fields for the projected field's options; else comma-separated text. Mirror override seeding copies `scopeFilters` deep.

**Why:** users abused resettable SOFT quick-filters (Эпоколь page) to see/edit other painters' orders; needed a per-role hard row boundary configurable on any field value.
**How to apply:** any new own-scope enforcement site automatically gets filter scope for free — never special-case "filter" at call sites; keep SQL and in-memory checks in lockstep; prod translations in exports/scope-filter-translations.sql.

## Page-local scope filters (pageId, added 2026-08)

`ScopeFilter` has optional `pageId`: when set, `fieldKey` is a PAGE-LOCAL field
of that mirror page (value in page_record_values). Encoded as `p` in the
`__valfilter__:` synthetic key. own-scope.ts partitions these into a third
bucket; clause = `inArray(pageLocalValueExpr(pageId, key), values)` — NULL never
matches (deny-safe), applied in BOTH ownScopeWhere and isRecordOwned.

**Config boundary:** role writes (POST/PUT /roles) validate pageId-bearing
scopeFilters — only allowed inside the matching `mirror:<pageId>` override, and
the field must be an ACTIVE value-backed page field. Runtime stays deny-safe
regardless, but bad configs are rejected at write time.

Roles UI: ScopeFilterEditor disambiguates page fields via a `pf:` select-value
prefix; mirror rows pass `mirrorPageId` down (forget this and the page-field
candidates silently never load).
