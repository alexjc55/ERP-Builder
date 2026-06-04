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
- Auth is custom email/password JWT (no self-registration). Role-based access control is a deliberately later roadmap stage — mutations are currently auth-gated only.

## Product

A metadata-driven platform constructor (Airtable/SmartSuite/Notion-like) for building production ERP systems through an admin interface without changing source code. Capabilities built so far:

- **Users & Roles** — admin-managed accounts, role definitions, block/unblock, password reset, login history.
- **Pages Builder** — create/edit/delete navigation pages and nested menu groups, reorder them, assign routes; the live sidebar updates automatically.
- **Entities Builder** — define data objects (tables) with a system key, multilingual names, icon, and optional binding to a page where they will be displayed.
- **Fields Builder** — define the columns of each entity: a system key, multilingual name/description, field type, required flag, default value, select options, and ordering. Reorder is entity-scoped.
- **Statuses Builder** — define the lifecycle statuses of each entity: a system key, multilingual name, color, default/final/active flags, and ordering. Reorder is entity-scoped; at most one default status per entity is enforced at the database layer (partial unique index).
- **Records (Data Management)** — create/edit/delete actual data rows for each entity. Values are stored as a JSONB `fieldKey → value` map and validated server-side against the entity's active fields (unknown key, required-missing, and per-type checks for number/boolean/date/datetime/email/url/phone/select). URL values are restricted to http/https to prevent stored XSS. Each record carries an optional status (the entity's default applied when omitted on create). Rows render as a dynamic table with per-field-type inputs; bound entities also surface their records on their assigned page.
- **Relations (Relations Engine)** — define typed relations between entities (one_to_one, one_to_many, many_to_one, many_to_many) with a system key, multilingual name/inverse-name. Records are linked across entities through a relation; cardinality is enforced at the DB layer via partial unique indexes on a denormalized relation type that is kept in lockstep with the parent relation by a `SELECT … FOR UPDATE` row lock on both link-create and type-change paths (type changes are forbidden while links exist). The link manager lives inside the record edit dialog; relations are managed from a per-entity "Связи" builder page.
- **Translations** — manage system UI strings in ru/en/he.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
