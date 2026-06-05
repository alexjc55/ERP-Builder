# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- DB schema (source of truth): `lib/db/src/schema/*` (one file per table, re-exported from `index.ts`)
- API contract (source of truth): `lib/api-spec/openapi.yaml` — run codegen after edits
- Generated client hooks + Zod: consumed via `@workspace/api-client-react` and `@workspace/api-zod`
- API routes: `artifacts/api-server/src/routes/*` (registered in `routes/index.ts`)
- Web app: `artifacts/erp-platform/src` — admin pages under `src/pages/admin/`, sidebar in `src/components/layout/Layout.tsx`, router in `src/App.tsx`

## Architecture decisions

- Metadata-driven: pages, entities, roles, menus, translations are all rows in PostgreSQL — no hardcoded screens or routes. The sidebar is built entirely from the `pages` table (each page has a `path`).
- Contract-first: every endpoint is defined in `openapi.yaml`, then client hooks and Zod validators are generated. Server validates with the generated Zod schemas.
- Multilingual content is stored as JSONB (`{ru,en,he}`) on each row, rendered via a `getML()` helper that falls back ru → en → he.
- Referential integrity is enforced in the DB/API (not assumed): e.g. `entities.page_id` is a FK with `ON DELETE SET NULL`, and one-entity-per-page is enforced server-side.
- Auth is custom email/password JWT (no self-registration). Role-based access control is implemented (see "Roles & Permissions" below): a structured `permissionsJson` per role, enforced as a hard boundary server-side and mirrored cosmetically in the UI. Permissions are read fresh from the DB per request, not embedded in the JWT.

## Product

A metadata-driven platform constructor (Airtable/SmartSuite/Notion-like) for building production ERP systems through an admin interface without changing source code. Capabilities built so far:

- **Users & Roles** — admin-managed accounts, role definitions, block/unblock, password reset, login history.
- **Pages Builder** — create/edit/delete navigation pages and nested menu groups, reorder them, assign routes; the live sidebar updates automatically.
- **Entities Builder** — define data objects (tables) with a system key, multilingual names, icon, and optional binding to a page where they will be displayed.
- **Fields Builder** — define the columns of each entity: a system key, multilingual name/description, field type, required flag, default value, select options, and ordering. Reorder is entity-scoped.
- **Statuses Builder** — define the lifecycle statuses of each entity: a system key, multilingual name, color, default/final/active flags, and ordering. Reorder is entity-scoped; at most one default status per entity is enforced at the database layer (partial unique index).
- **Records (Data Management)** — create/edit/delete actual data rows for each entity. Values are stored as a JSONB `fieldKey → value` map and validated server-side against the entity's active fields (unknown key, required-missing, and per-type checks for number/boolean/date/datetime/email/url/phone/select). URL values are restricted to http/https to prevent stored XSS. Each record carries an optional status (the entity's default applied when omitted on create). Rows render as a dynamic table with per-field-type inputs; bound entities also surface their records on their assigned page.
- **Relations (Relations Engine)** — define typed relations between entities (one_to_one, one_to_many, many_to_one, many_to_many) with a system key, multilingual name/inverse-name. Records are linked across entities through a relation; cardinality is enforced at the DB layer via partial unique indexes on a denormalized relation type that is kept in lockstep with the parent relation by a `SELECT … FOR UPDATE` row lock on both link-create and type-change paths (type changes are forbidden while links exist). The link manager lives inside the record edit dialog; relations are managed from a per-entity "Связи" builder page.
- **Record Views (Views Engine)** — saved per-entity views with a system key, multilingual name, default/active flags, and ordering (mirrors the statuses pattern: unique key per entity + a partial unique index for one default view per entity). Each view stores a `configJson` query spec (`filters`, `filterConjunction`, `sorts`, `search`, `visibleFields`). A server-side query endpoint (`POST /entities/{id}/records/query`) runs type-aware filtering/sorting/search in Postgres against the JSONB `valuesJson`: filter/sort field keys are whitelist-validated against the entity's active fields, all values are bound params, and search is OR ILIKE across text-like field types; it returns `{ data, total }` for pagination. The records screen has a view selector, ad-hoc search box, and pagination, and honors a view's `visibleFields`; views are managed from a per-entity "Виды" builder page.
- **Field & Row Permissions (fine-grained access)** — two boundaries layered on top of record CRUD. **Field-level:** each field carries `permissionsJson` (roleId → `hidden|view|edit`); an unset field inherits the role's record perm (`update`⇒edit else view) so existing data is backward-compatible. The server is the hard boundary: hidden fields are stripped from every record response (list/query/get/create/update) AND excluded from the query filter/sort/search whitelist so they can't be inferred; merge-on-write means only editable fields are accepted on write, others keep their stored value. The client mirrors this in `lib/auth.tsx` `fieldAccess()` (hides hidden fields, disables view-only inputs). **Row-level scope:** `RecordPermission` carries `scope: all|own` + `scopeFieldKeys` (keys of `user`-type fields); `own` filters records to those where any listed user-field equals the current user (own + no keys ⇒ no rows); get/update/delete re-check ownership (404 if not owned). A new `user` field type stores a user id (validated against the users table) and is picked via `GET /users/options`. Managed from the roles editor (scope section) and the fields builder (per-role field access editor).
- **Roles & Permissions (RBAC)** — each role carries a structured `permissionsJson` spec: `superAdmin` (bypasses all checks), `admin` capabilities (pages/entities/roles/users/translations builder areas), `pageIds` (content-page visibility), and per-entity `records` CRUD (view/create/update/delete). Permissions are loaded fresh from the DB per request (role changes take effect on the next request; not baked into the JWT). The backend is the hard boundary — admin mutations are gated by the matching `admin.*` capability, record reads/query by `view`, create by `create`, update/delete by `update`/`delete`; metadata GETs stay auth-only so the shell can render. The frontend mirrors this cosmetically: the sidebar filters by capability/pageId, admin routes show a "no access" screen without the capability, content pages are guarded by `canPage` at the route (sidebar hide + direct-URL block), and record CRUD buttons hide per permission. `/me` and login return the effective permissions. The roles editor offers a superAdmin toggle (locks the rest), admin-cap checkboxes, content-page access checkboxes, and a per-entity record CRUD matrix (write implies view; unchecking view clears writes).
- **Workflow Engine (status transitions)** — per-entity `entity_transitions` built on top of the existing `entity_statuses` (no parallel workflow table). Each transition is a from-status → to-status edge with multilingual name, `allowedRoleIds`, `requiredFieldKeys`, `set_field` actions, and ordering; unique per (entity, from, to). The server is the hard boundary on record status changes: superAdmin bypasses entirely; a null current status or an entity with no transitions changes freely (backward compatible); otherwise a change must match a defined transition (422), pass `allowedRoleIds` (empty = all roles, else 403), apply `set_field` actions before validation, and require `requiredFieldKeys` non-empty (422). The status update is a compare-and-set — the UPDATE is guarded on the row's status still being the validated from-status (409 on concurrent drift) so a race cannot bypass the transition graph. Transitions are managed from a per-entity "Процессы" builder page; the records edit dialog restricts the status select to allowed transition targets and surfaces required-field hints, mirroring the server cosmetically.
- **Archive Engine (Stage 11)** — archival is a flag on the record (`archivedAt`), never a separate table. A status can be flagged `isArchiveTrigger` with `archiveAfterDays` (N-day delay). **Auto-archival** is metadata-driven and lazy: a sweep runs on every list/query read and stamps `archivedAt` on any record dwelling in a trigger status past `COALESCE(statusChangedAt, createdAt) + archiveAfterDays` (idempotent on `archivedAt IS NULL`); a status change into a delay=0 trigger archives immediately. `statusChangedAt` is the auto-archive baseline (stamped on create and on every status change). **Manual** archive/unarchive endpoints (`POST /records/{id}/archive|unarchive`) are gated exactly like a record update (record `update` perm + ownership scope). **Display rule:** archived rows are hidden by default — the GET list is always active-only; the query endpoint takes `archived: active|archived|all`. A server-internal `archiveExempt` flag makes a manual unarchive durable (the sweep skips exempt rows) until the next status change clears it; changing status away from a trigger never auto-unarchives (unarchive is always explicit). Managed from the per-entity "Статусы" builder (archive-trigger toggle + days) and the records screen (Активные/Архив/Все filter, per-row archive/restore, "В архиве" indicator).
- **Translations** — manage system UI strings in ru/en/he.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Orval param-name collision:** giving a path-param endpoint a query param too makes Orval emit two `*Params` exports (a zod path-params object in `api.ts` and a query-params type in `generated/types/`), which the api-zod barrel re-exports → TS2308. Endpoints with only query params are fine (zod object is `*QueryParams`). Avoid adding query params to path-param GETs; carry filters on a POST body instead.

## Roadmap

- Canonical 16-stage build order lives in `attached_assets/Pasted--Development-Roadmap-Production-ERP-Builder--1780595460_1780595460450.txt` (plus a Master Product Spec and Technical DB Architecture doc in the same folder).
- Progress: stages 1–11 complete (Core Infra → Users/Roles → Pages → Entities → Fields → Records → Relations → Views → Permissions → Workflow → Archive). **Next = Stage 12: Audit & History.**
- Remaining after that: 13 Localization, 14 Event System, 15 Modules Architecture, 16 Production ERP Configuration.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
