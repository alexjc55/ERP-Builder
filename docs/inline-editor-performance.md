# Inline editor performance checks

## Safe production checks

Run from the workspace root:

```sh
# Fresh production build, isolated static server, 200-row performance budget:
node scripts/run-inline-editor-profile.mjs

# Fresh production build, all mocked refresh/editor regressions:
node scripts/run-inline-editor-profile.mjs --full-spec
```

The equivalent package scripts are `test:e2e:inline-editor-profile:prod` and
`test:e2e:stable-background-refresh:prod`. Dependencies must already be installed.
The runner invokes the local Vite and Playwright executables directly.

These commands only select `stable-background-refresh.spec.ts`. They do not
start the API, connect to the database, or run the general collaboration suite.
All API responses are supplied by the browser fixture; the isolated static
server also rejects escaped `/api/` requests. Temporary production builds are
deleted when the runner exits.

## What the budget means

The fixture mounts **200 rows and 1,200 cells**, saves a page-local scalar, holds
an unrelated relation-projection request, and opens an entity select. It then
acknowledges a select save and measures reopening the saved cell while that
projection is still pending. This tests responsiveness without weakening the
write/version or retained-snapshot behavior.

Both first open and reopen must paint the option within **250 ms of the actual
browser pointerdown**. A capture listener starts the browser clock; a mutation
observer detects a visible option, then two animation frames allow its first
visible frame to paint. It is not just JavaScript handler duration.

The reference environment is local headless Chromium, a production/minified
build, one worker, no CPU or network throttling. This is a regression budget for
this fixture, not a promise for every device, column type, or live request.
Full Playwright click-to-visible wall times are also retained as diagnostics.
They include locator/actionability/accessibility work, which is not the same
as the user's pointer-to-paint latency and is not used for the 250 ms budget.

The initial pre-isolation production full-wall baseline was 543 ms first open /
498 ms reopen (another run: 589 / 587 ms). After isolating row rendering, full
wall times initially remained similar; that alone did not prove faster opening.
An identical browser-clock comparison of immutable before/after production
bundles measured:

| Measurement | Before | After |
| --- | ---: | ---: |
| First pointer → option paint | 201.1 ms | 170.4 ms |
| Reopen pointer → option paint | 274.5 ms | 208.8 ms |
| First full Playwright wall time | 492 ms | 329 ms |
| Reopen full Playwright wall time | 579 ms | 578 ms |

These are individual comparison runs, not universal latency guarantees.
Earlier development full-wall measurements were 4.27 s / 2.79 s; the extracted
row version measured 930 ms / 777 ms without debug logging. Development JSX
instrumentation adds considerable overhead, so do not compare a development
result directly with a production budget.

## Diagnostics and repeatability

The runner prints `INLINE_EDITOR_PROFILE_ARTIFACT` with the build source, asset
names, sizes and SHA-256 hashes. `INLINE_EDITOR_PROFILE_RESULT` contains the
timings and CPU summary. Detailed diagnostics are in
`test-results/inline-editor-profile/`; the dedicated Playwright configuration
keeps its own result directory.

To compare an already captured immutable build, explicitly set
`INLINE_EDITOR_PROFILE_DIST_DIR` to its static output directory. Without this
override the runner always builds current source, so a stale `dist` cannot
silently pass the check. For diagnostic runs only,
`INLINE_EDITOR_PROFILE_BUDGET_MS` can override the limit; do not raise the
default to hide a regression.

Keep other heavy validation/build processes stopped while measuring. Compare
like-for-like builds and fixtures. A failing budget should prompt examination
of row-render invalidations and the CPU profile, not changes to CAS checks,
request-generation guards, or editor lifetime.

The source-level dependency guard can be run separately:

```sh
node --test tests/inline-row-dependencies.test.mjs
```

It uses TypeScript's bound symbols to ensure every captured input in the shared
row context participates in its memoization dependencies. Stable React setters
and refs are exempt. This complements, rather than replaces, browser tests.