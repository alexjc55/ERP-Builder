---
name: ERP Platform Core
description: Key decisions for the Production ERP Builder platform (stages 1-2)
---

## Seed accounts (dev)
- The DB is seeded with dev accounts (admin role_id=1, manager role_id=2, cfo role_id=5). For exact emails/passwords read the seed script in `lib/db` — never store credentials here.

## API shape gotchas
- `GET /api/pages` returns a FLAT array (not a tree). Frontend filters by parentPageId client-side.
- `GET /api/users` returns `{ data: User[], total: number }` (UserListResult), NOT a plain array.
- `roleName` and `nameJson` on roles/pages are typed as `MultilingualText` (not `Record<string,string>`). Use `getML()` helper: `val.ru || val.en || val.he || ""`.
- `UserProfile.roleName` is `MultilingualText | string | undefined` — always coerce to string before rendering.

## Auth
- JWT stored in localStorage key `erp_token`. Bearer token in Authorization header.
- `SESSION_SECRET` env var is the JWT signing secret.
- No self-registration; admin creates users only.

## useGetMe queryKey
- Must pass `queryKey: getGetMeQueryKey()` inside the `query:{}` options due to TanStack Query v5 requiring queryKey.

## lib rebuild rule
- After schema changes in `lib/db`: run `pnpm run typecheck:libs` before leaf artifact typechecks, or api-server will report missing exports.

**Why:** tsc --build caches composite lib declarations; stale cache causes false "no exported member" errors in consuming packages.

## Dynamic menu (Stage 3)
- The sidebar menu is fully metadata-driven from the `pages` table — NO hardcoded route map. Each page row has a `path` column (nullable text); the menu links to `page.path`.
- A page with children and a NULL `path` acts as a non-navigable group header (e.g. "Administration").
- Custom pages created via the builder whose `path` matches no real React route fall through to `DynamicPage` (catch-all `<Route>` in App.tsx), which shows a "page has no entity yet" placeholder until Stage 4 (Entities Builder) wires content.
- `GET /api/pages` returns a FLAT array (not a tree); sidebar/admin filter by `parentPageId` client-side.

## Pages backend invariants
- DELETE /pages/:id returns 409 if the page has sub-pages (no orphaning). Frontend shows a toast on this.
- To move a child back to root, send `parentPageId: null` (not undefined) — backend applies `?? null` so the column actually clears.
- /pages/reorder runs all sortOrder updates in a single db.transaction.

**Why:** The whole product premise is metadata-driven with no hardcoded data; a hardcoded name→route map violated that and broke for admin-created pages.

## Entities Builder (Stage 4)
- `entities` table = metadata definitions of data objects (Stage 5 adds fields, records come later). Has unique `entity_key` slug (regex `^[a-z][a-z0-9_]*$`, validated server-side), multilingual nameJson/descriptionJson, icon, sortOrder, isActive.
- `entities.page_id` is a real FK to `pages.id` with **ON DELETE SET NULL** — deleting a page auto-nulls bound entities (no orphans). Set via Drizzle `.references(() => pagesTable.id, { onDelete: "set null" })`.
- **Binding cardinality: ONE entity per page.** Server rejects a second binding to the same page with 409 (`validatePageBinding`). Keeps DynamicPage deterministic (it `find()`s the single active entity bound to the page).
- POST/PUT /entities validate that a provided pageId exists (400 if not) before binding.
- PUT /entities/:id with an empty effective payload returns 400 "No fields to update" (avoid Drizzle `.set({})` runtime error).
- entityKey uniqueness conflict → 409 on both create and update (update excludes self via `ne(id)`).

**Why:** Metadata-driven platform must keep referential integrity itself since there are no hardcoded relationships; architect review flagged orphan/cardinality/empty-set gaps in the first pass.

## Fields Builder (Stage 5) — integrity decisions
- Any bulk-reorder endpoint must be SCOPED to its parent: require the parent id in the body, verify every child id belongs to that parent, and add the parent id to each UPDATE's WHERE. A reorder that updates by child id alone can silently mutate another parent's rows.
- Uniqueness must be enforced at TWO layers: an app-level precheck AND mapping the DB unique-violation (Postgres 23505) to 409. The precheck alone is racy; rely on the DB constraint as the source of truth.

**Why:** this is a metadata platform with no hardcoded relationships, so the API must enforce referential integrity itself. Architect flagged a blind cross-entity reorder as the gap these rules close. Applies to every future child-of-parent builder (fields, options, sub-records, etc.).

## Statuses Builder (Stage 6) — "one default" invariant
- An "at most one X per parent" invariant must be guarded at the DB layer, not just in app logic. App-level "unset others then set this" inside a transaction is correct for single requests but RACY under concurrency. Use a Postgres PARTIAL UNIQUE INDEX (Drizzle: `uniqueIndex(name).on(t.parentId).where(sql\`${t.flag} = true\`)`) as the hard guard.
- Semantics chosen: AT MOST ONE default per entity (zero is allowed, e.g. mid-configuration; unsetting/deleting the default does not force promotion). Not "exactly one".
- When a table has multiple unique constraints, the 23505 handler must branch on `err.constraint` (the constraint/index name) to return the right 409 message — don't assume every 23505 is the key conflict.

**Why:** architect FAILed the first pass because the default invariant was only app-enforced (concurrency race). The partial unique index closes it. Applies to any future single-flag-per-parent rule (e.g. primary field, default option).

## Records / Data Management (Stage 7)
- `entity_records`: valuesJson (jsonb fieldKey→value map), entityId FK CASCADE, statusId FK SET NULL (nullable).
- Record values are validated server-side against the entity's ACTIVE fields: unknown key→400, required-missing→400, per-type checks for number/boolean/date/datetime/email/url/phone/select-options.
- URL fields: must be valid URL AND http:/https: only — other schemes (javascript:, ftp:, etc.) are rejected to prevent stored-XSS via clickable links. **Why:** UI renders url values as `<a href>`.
- Create status semantics: statusId OMITTED (undefined) → apply entity default status; statusId explicitly null → keep null; a number → must belong to the entity. RecordInput zod uses `nullish()` so undefined vs null is distinguishable; do NOT collapse them.
