# API memory diagnostics

The API has an opt-in, aggregate-only process memory sampler. It is off by
default and adds no request listeners or periodic work unless explicitly
enabled. Each record contains only:

- `rss`
- `heapUsed`
- `heapTotal`
- `external`
- `arrayBuffers`
- `activeRequests` (when the API request tracker is installed)

The values are byte counts except `activeRequests`. No payload, URL, header,
cookie, user identifier, heap dump, or object-retainer information is logged.
The interval is 60 seconds by default and is bounded to 1 second through 1
hour. Its timer is `unref()`'d, so it cannot keep the API process alive.

## Explicit startup commands

For a local API process:

```sh
ERP_MEMORY_DIAGNOSTICS=1 pnpm --filter @workspace/api-server run dev
```

For an already-built process:

```sh
ERP_MEMORY_DIAGNOSTICS=1 pnpm --filter @workspace/api-server run start
```

The sampling interval can be changed for an incident without changing code:

```sh
ERP_MEMORY_DIAGNOSTICS=1 \
ERP_MEMORY_DIAGNOSTICS_INTERVAL_SECONDS=300 \
pnpm --filter @workspace/api-server run start
```

Do not add `--expose-gc` to an API/server command. This instrumentation does
not force collection, expose an endpoint, or take heap dumps.

On `SIGTERM` or `SIGINT`, the single startup-owned shutdown path stops the
sampler, disposes collaboration SSE streams/presence timers, clears the
inbound recovery poll, and gracefully closes the retained HTTP server. It
waits at most 5 seconds before forcing remaining HTTP connections closed.
Signal registration and cleanup are idempotent, so repeated startup/teardown
does not add duplicate process handlers.

## Safe read-only reproduction

The focused harness uses the existing development fixture through `SELECT`
queries only. It imports the real `formula-runtime` and
`linked-formula-resolver` path, including linked-source resolution, the
request-owned dependency cache (a miss followed by a clone-safe cache hit),
permission-context identity, and page formula materialization. It does not
load the API app, routes, authentication, or collaboration modules, and it
contains no database write operation:

```sh
pnpm --filter @workspace/api-server run diagnostics:memory:repro
```

It runs bounded request cycles and emits one JSON record with memory points,
field/row counts, and a checksum. Defaults are 100 fixture rows per cycle and
10 cycles; rows are capped at 500 and cycles at 1,000. Every cycle creates a
fresh permission-context object and request cache. Resolver outputs,
materialized values, and permission scope become unreachable before the next
cycle. For a larger but still bounded run:

```sh
ERP_MEMORY_REPRO_ROWS=500 ERP_MEMORY_REPRO_CYCLES=20 \
pnpm --filter @workspace/api-server run diagnostics:memory:repro
```

For a controlled cache-expiry/permission-scope stress window, the same
read-only harness accepts at most 1,000 cycles:

```sh
ERP_MEMORY_REPRO_ROWS=100 ERP_MEMORY_REPRO_CYCLES=1000 \
pnpm --filter @workspace/api-server run diagnostics:memory:repro
```

If `DATABASE_URL` or the fixture is unavailable, the command reports
`status: "unavailable"` and `attribution: "none"` rather than making an
unsupported claim. V8 may delay collecting temporary objects, so a rising
`heapUsed` without an available collection signal is not proof of a leak. An
operator may run this **isolated script only** with Node's optional
`--expose-gc` to improve post-collection comparisons; never use that flag for
the API server:

```sh
node --expose-gc \
  --import ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs \
  artifacts/api-server/src/lib/memory-diagnostics.repro.ts
```

One local validation run used the real fixture (entity 72/page 119, 100 rows,
34 entity fields, 6 page fields, 10 request cycles, `gcAvailable: true`). After
the initial warm-up, post-GC `heapUsed` stayed around 20.90–21.28 MB while
`heapTotal` stayed around 58.16 MB; `rss` rose from about 209 MB at baseline to
245 MB and then flattened. This is useful evidence against an obvious
request-scope JavaScript heap retention in this bounded fixture, but it is not
a production measurement or proof that every workload is leak-free. RSS can
include allocator/driver/runtime high-water memory, and a separately approved
heap profile would still be needed to attribute a retained object.

## Current hotspot evidence and follow-up

No formula or dashboard computation was changed for this diagnostic. The
current source shows allocation-heavy, request-scoped paths that should be
correlated with sampler data rather than assumed to be leaks:

- `mergeLinkedFormulaInputs` creates a row map and clones cached dependency
  values. Its request-cache key recursively sorts/normalizes row values and
  serializes the result, so wide rows or many rows can cause temporary
  `heapUsed`/`external` pressure.
- `buildQualifiedFormulaScope` copies entity/page values and creates qualified
  formula aliases. The pure evaluator then memoizes formula results per scope.
  This is intentionally request-local and should disappear from retained
  memory after the response.
- Dashboard pivot computation loads candidate rows, builds `formulaInputs`, and
  computes the pivot; the dashboard data route evaluates visible widgets with
  `Promise.all`. A wide pivot or several simultaneous dashboard requests can
  therefore explain a high `activeRequests`/`heapUsed` sample without proving
  long-lived retention.

The fastest safe production follow-up is to enable the sampler for one
controlled window, correlate aggregate samples (especially `activeRequests`)
with route-level traffic, then repeat the isolated harness with the same
approximate row/formula width. A monotonic post-idle `heapUsed` or `rss` trend
with low active requests is evidence for a retention investigation; a sawtooth
that returns toward a baseline after load is more consistent with temporary
allocation or allocator/V8 high-water behavior. These counters cannot identify
the retaining object, and a heap profile would require a separately approved,
carefully controlled diagnostic—not a public API endpoint.