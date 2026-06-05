---
name: Admin capability stage pattern
description: The repeatable recipe for adding a new metadata-driven admin area (RBAC cap + OpenAPI CRUD + gated route + DB-backed i18n screen) in the ERP Builder.
---

# Adding a new admin-gated area (Roles / Events / Modules stage pattern)

When a roadmap stage asks for a new metadata-managed admin area, follow this recipe — every existing stage (roles, events, modules) is built the same way:

1. **RBAC capability** — add the new boolean to `RoleAdminCaps` + `NO_ACCESS_PERMS` in `lib/db/src/schema/roles.ts`. This is **JSONB-only, no migration**: old role rows simply lack the key ⇒ falsey ⇒ denied. That is the intended secure default; superAdmin bypasses all caps.
2. **Contract-first** — define schemas + CRUD paths in `lib/api-spec/openapi.yaml`, add the cap to the `RoleAdminCaps` schema (property **and** required list), then run `pnpm --filter @workspace/api-spec run codegen`. Server validates with the generated `@workspace/api-zod` schemas.
3. **Server is the hard boundary** — every route gated `requireAuth, requireAdmin("<cap>")`. Mutations enforce real rules; don't rely on the client.
4. **Client mirrors cosmetically** — wire the cap through: roles editor (`ADMIN_CAP_LABELS` + the default perms object), `lib/permissions.ts` `adminCapForPath`, the App route, and the sidebar (icon map). Plus a DB `pages` row for the route under the admin group.
5. **i18n** — add curated `{ru,en,he}` keys to `scripts/src/data/ui-translations.json` and run `pnpm --filter @workspace/scripts run seed-translations`.

**Why:** consistency across stages keeps RBAC a single predictable boundary and avoids drift. Diverging (e.g. gating on the client only, or baking caps into the JWT) reintroduces bypass risk — perms are read fresh from the DB per request by design.

**How to apply:** use it for any future "manage X via admin screen" stage. Scope guard: if the spec says build the *infrastructure/registry*, do NOT build the concrete instances (e.g. Stage 15 Modules = the registry, not actual WhatsApp/Telegram plugins).

## Gotchas reinforced by these stages
- **Duplicate-key 409 needs both layers:** a read-before-write check is racy; also catch the pg unique violation (`23505`, walk the `err.cause` chain — drizzle wraps it) on insert so the 409 holds under concurrency. Empty PATCH/PUT bodies should 400 ("No fields to update") rather than hitting an empty `.set({})`.
- **Orval param collision:** never give a path-param GET a query param too — Orval emits two `*Params` exports → TS2308 in the api-zod barrel. Carry filters on a POST body, or keep the endpoint query-params-only.
