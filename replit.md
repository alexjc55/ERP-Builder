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

A metadata-driven platform constructor (Airtable/SmartSuite/Notion-like) for building production ERP systems through an admin interface without changing source code. This is a capability index — deep implementation detail and durable invariants live in the `.agents/memory/` topic files referenced below.

- **Users & Roles** — admin-managed accounts, block/unblock, password reset, login history.
- **Pages Builder** — create/edit/reorder navigation pages and nested menu groups; the live sidebar is built from the `pages` table.
- **Entities Builder** — define data objects (tables) with a system key, multilingual names, icon, and optional binding to a page.
- **Fields Builder** — define each entity's columns (key, multilingual name/description, type, required, default, select options, ordering, `isFilterable`).
- **Statuses Builder** — define each entity's lifecycle statuses (color, default/final/active flags, archive-trigger). At most one default per entity (DB partial unique index).
- **Records (Data Management)** — CRUD data rows; values stored as a JSONB `fieldKey → value` map, validated server-side per field type (URLs restricted to http/https). Rendered as a dynamic per-field-type table. Memory: `editable-records-table.md`.
- **Relations Engine** — typed entity-to-entity relations (1:1, 1:N, N:1, N:N) with DB-enforced cardinality. Memory: `relations-engine.md`.
- **Record Views (Views Engine)** — saved per-entity views (filters/sorts/search/visibleFields) backed by a POST query endpoint with type-aware filtering in Postgres. Memory: `record-views-query.md`.
- **Records Filter Bar (dependent filters)** — search + status quick-filter + per-field opt-in dropdowns whose options narrow by the other active filters. Memory: `dependent-filters.md`.
- **Field & Row Permissions** — per-field `hidden|view|edit` and per-row `all|own` scope, enforced as a hard server boundary. Memory: `erp-field-row-permissions.md`, `erp-display-only-hide.md`.
- **Roles & Permissions (RBAC)** — structured `permissionsJson` per role (superAdmin, admin caps, page visibility, per-entity record CRUD), loaded fresh per request, hard boundary server-side. Memory: `rbac-permissions.md`.
- **Workflow Engine** — per-entity status transitions (roles, required fields, set-field actions) enforced as a compare-and-set on the records update path. Memory: `workflow-engine.md`.
- **Archive Engine** — archival as a record flag with lazy metadata-driven auto-archival and explicit manual archive/unarchive. Memory: `archive-engine.md`.
- **Audit & History** — best-effort change history (who/when/what/old→new) that re-applies the field-hidden boundary on read. Memory: `audit-field-security.md`.
- **Impersonation** — admin "log in as user" on top of the custom JWT with no-escalation guard. Memory: `erp-impersonation.md`.
- **Passwordless Guest Access** — "client = passwordless user": admins create a passwordless account + a "Гость" role, then generate an unguessable shareable link that mints a read-only guest JWT (RBAC drives sidebar/columns/own-rows). Read-only is a hard guard at `requireAuth`; guest reads are side-effect free; links bind to passwordless accounts only. Memory: `guest-access.md`.
- **Event System** — internal best-effort event bus + durable log; foundation for future automations. Memory: `event-system.md`.
- **Modules Architecture** — metadata-driven registry/infrastructure for pluggable capabilities. Each module is a row in the `modules` table that can be toggled on/off; system modules (e.g. `google_drive`) are non-deletable, and a module exposes its config screen via a per-module "Настройки" button rather than a hardcoded sidebar entry. Google Drive is the first real module. Memory: `admin-cap-stage-pattern.md`, `multi-source-file-field.md`.
- **Settings & Branding** — `/settings` page: profile (own firstName/lastName + change password) for any authed user, and admin-only platform branding (app name + subtitle multilingual + logo) stored in a singleton `app_settings` row that drives the sidebar header. `GET /settings` is auth-only (sidebar needs it); `PUT /settings` is gated by RBAC cap `settings`. Logo served publicly at `/storage/branding-logo` (path from DB, not user input → no IDOR). Memory: `settings-branding.md`.
- **Localization Engine** — whole UI switchable ru/en/he with all strings DB-backed (no locale files). Memory: `erp-i18n.md`.
- **Translations** — manage system UI strings in ru/en/he.
- **Multi-source file fields** — the `file` field type is polymorphic at fill time (server upload / Google Drive upload / pasted link); admins opt into allowed sources per field. Managed Drive files are reference-based and served through a permission-mirroring proxy. Google Drive uses `drive.file` scope with built-in (env creds) or own-keys (admin creds, AES-256-GCM at rest) modes, configured at `/admin/google-drive` (reached via its Module's "Настройки" button — Drive is a toggleable system module in the Modules registry, not a sidebar item). When the module is off, Drive is not offered as a file source and new gdrive writes/uploads are blocked server-side, while existing stored gdrive values stay readable. Memory: `multi-source-file-field.md`, `app-secret-fail-fast.md`.

> Pattern for adding a new admin area (RBAC cap + OpenAPI CRUD + gated route + DB-backed i18n screen): `admin-cap-stage-pattern.md`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Orval param-name collision:** giving a path-param endpoint a query param too makes Orval emit two `*Params` exports (a zod path-params object in `api.ts` and a query-params type in `generated/types/`), which the api-zod barrel re-exports → TS2308. Endpoints with only query params are fine (zod object is `*QueryParams`). Avoid adding query params to path-param GETs; carry filters on a POST body instead.

## Roadmap

- Canonical 16-stage build order (plus Master Product Spec and Technical DB Architecture) lives in `attached_assets/Pasted--Development-Roadmap-Production-ERP-Builder--1780595460_1780595460450.txt`.
- Stages 1–15 complete. **Next = Stage 16: Production ERP Configuration** (the last remaining stage).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- Deep per-feature implementation detail and durable invariants live in `.agents/memory/` (indexed in `MEMORY.md`).
