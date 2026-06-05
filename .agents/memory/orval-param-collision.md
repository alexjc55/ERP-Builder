---
name: Orval param-name collision
description: Why adding a query param to a path-param GET breaks api-zod codegen, and how to avoid it.
---

When an OpenAPI operation has BOTH a path param and a query param, Orval's zod
generation emits a `<Op>Params` zod object (path params) in
`lib/api-zod/src/generated/api.ts` AND a `<Op>Params` TypeScript type (query
params) in `lib/api-zod/src/generated/types/`. The api-zod barrel re-exports both
(`export * from "./generated/api"` and `export * from "./generated/types"`),
producing a TS2308 duplicate-export error and failing `pnpm run typecheck:libs`.

Operations with only query params (e.g. listUsers) do NOT collide — there the
zod object is named `<Op>QueryParams` and the type is `<Op>Params`, distinct names.

**Why:** the collision only appears when a path-param zod object and a
query-param type share the exact base name `<Op>Params`.

**How to apply:** do not add query params to a GET that already has a path param.
Carry list filters on a POST body instead (this repo uses
`POST /entities/{id}/records/query` with a RecordQuery body for record filtering).
The plain GET list stays path-only and returns a sensible default subset.
