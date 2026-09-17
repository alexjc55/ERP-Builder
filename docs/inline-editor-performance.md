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

## Inline list positioning

Ordinary select and list-mode percent editors use a shared **non-modal listbox**
in `InlineListPicker.tsx`, backed by the existing Popover. This avoids modal
Select's document scroll locking and associated whole-page layout work.
Floating UI still provides positioning, viewport fitting and collision handling;
the global Select component and other menus are unchanged. Commit, cancellation,
retry, ACK-first publication and version handling remain in InlineCellEditor.

An intermediate local `item-aligned` Select candidate improved first opening
but **was rejected**: independent repeat runs measured 281.1 / 295.6 ms reopening,
exceeding the unchanged budget. It is not the delivered implementation.

The same production fixture, with 200 rows and 1,200 cells, measured:

| Measurement | Row-memoized modal Select baseline | Non-modal run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: | ---: |
| First pointer → option paint | 221.2 ms | 62.9 ms | 77.0 ms | 59.1 ms |
| Reopen pointer → option paint | 197.3 ms | 65.6 ms | 69.8 ms | 62.5 ms |
| First full Playwright wall time | 581 ms | 212 ms | 321 ms | 216 ms |
| Reopen full Playwright wall time | 459 ms | 404 ms | 339 ms | 380 ms |

Each final run made a fresh production build; runs were sequential without
other validation workloads. All three passed the unchanged 250 ms browser
budget. The baseline is one comparison run, not a statistical latency guarantee.
Do not describe opening as instantaneous or generalize these results to every
device, live request, or picker type.

The full mocked spec additionally checks a 100-option list at the bottom/right
edge in LTR and Hebrew RTL, popup bounds, keyboard access to every item,
scroll-to-focused-item behavior, Escape, typeahead, Enter and versioned saving.
It also checks no body scroll lock, unchanged-value selection without a write,
reopening a selected option beyond the initial viewport, and clearing a value.
The list re-reveals its focused option after collision placement supplies its
final viewport size. Keyboard tests await each focus change before the next key.