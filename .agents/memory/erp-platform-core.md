---
name: ERP Platform Core
description: Key decisions for the Production ERP Builder platform (stages 1-2)
---

## Seed accounts (dev)
- admin@erp.local / Admin@123 → role_id=1 (Administrator)
- manager@erp.local / Manager@123 → role_id=2 (Project Manager)
- cfo@erp.local / Manager@123 → role_id=5 (CFO)

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
