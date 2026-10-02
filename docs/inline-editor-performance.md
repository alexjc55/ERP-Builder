# Inline editor performance checks

## Safe production checks

Run from the workspace root:

```sh
# Fresh production build, isolated static server, full 200-row editor profile matrix:
node scripts/run-inline-editor-profile.mjs

# Fresh production build, all mocked refresh/editor regressions:
node scripts/run-inline-editor-profile.mjs --full-spec
```

The equivalent package scripts are `test:e2e:inline-editor-profile:prod` and
`test:e2e:stable-background-refresh:prod`. Dependencies must already be installed.
The runner invokes the local Vite and Playwright executables directly.

The profile command selects `stable-background-refresh.spec.ts`; full-spec also
includes `collab-tooltip-formula-metadata.spec.ts`. Repeat `--spec tests/e2e/name.spec.ts`
to override the selection (for example to verify just one owned spec). They do not
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
silently pass the check. `INLINE_EDITOR_PROFILE_BUDGET_MS` may tighten the limit,
but the runner rejects values above 250 ms (and zero, negative or non-finite
values). A failure must not be hidden by raising the production budget.

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

Ordinary select, list-mode percent and system status editors use a shared **non-modal listbox**
in `InlineListPicker.tsx`, backed by the existing Popover. This avoids modal
Select's document scroll locking and associated whole-page layout work.
Floating UI still provides positioning, viewport fitting and collision handling;
the global Select component and other menus are unchanged. Commit, cancellation,
retry, ACK-first publication and version handling remain in InlineCellEditor
and the status-specific InlineStatusPicker.

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

## Consolidated reliability coverage (#122–124)

The default runner now selects **all `profile:` tests**, retaining the original
select baseline and adding system status, percent-list, user and relation. Use
`--grep 'profile: status'` (or percent/user/relation) for a focused diagnosis.
`--full-spec` runs mock regressions with performance probes skipped.

The four new fixtures each retain 200 rows and loaded user/status/percent candidates.
Status/percent/user hold an unrelated relation projection; relation holds an
unrelated records read, not its own link projection (which correctly blocks
assignment until refreshed). Relation candidates are fetched through the
actual picker and retained in its mounted component. Cold, debounced hydration
wall time is reported separately as `candidateHydrationWallMs`, not disguised as
a loaded-candidate first open. Both first loaded opening and reopening after a
single guarded save have the unchanged 250 ms pointer-to-paint budget.
Playwright wall timings are retained separately, never substituted for browser
timings. User/relation paint selectors target a candidate, not the search input
or the relation's always-present clear command.

New artifacts are `matrix-{status,percent,user,relation}.json` and corresponding
`.cpuprofile` files. JSON retains per-opening DOM node counts, final rows/cells,
page/console errors, unknown API requests, candidate request counts, expected
and acknowledged version, and ACK-first checks. Diagnostics are written in
`finally`, including on failed assertions, and attached to Playwright results.
Do not compare the larger fixture's node count with the original 1,200-cell
select fixture as if the layouts were identical.

The metadata matrix publishes changed mock server responses and uses the real
global refresh control to refetch active metadata. Every data row is checked for
language/RTL, application/page/field content direction, decimal formatting,
before/after display affixes, column order/pinning, cell/text/row conditional
colors and viewer-local width. Width uses the real resize handler and window
pointermove/up persistence path, not fictitious server width. Refresh and resize
are dispatched without moving focus to model background changes: the unsaved
input must remain the same node with unchanged value, focus and backward
selection, and no write. No test injects React state or changes query caches.

Trusted-touch tests use Chromium CDP `Input.dispatchTouchEvent` and verify
trusted touchstart/move/end reception. Ordinary select and percent lists are
tested in English LTR and Hebrew RTL at bottom/side edges: swipe to both ends,
tap select, reopen the far-end selection, reselect unchanged without writing,
clear, cancel by outside tap/Escape and reopen. Gestures must leave background/
window scroll unchanged, never lock the body or save. Each changed selection/
clear issues exactly one current-version CAS. Percent picker request values are
numeric strings and clear is an empty string, matching the current inline API
contract; the mock server normalizes them to a number/empty display as the real
server does. Programmatic scrollTop, DOM-dispatched touch or keyboard movement
never substitutes for finger scrolling in these tests.

### Coordinated production verification

The final sequential fresh-production full-spec run verified both included suites:
**27 passed, 5 opt-in profiles skipped**, including all three tooltip/formula tests,
every metadata row check and all four trusted-touch scenarios. The separately
executed final fresh-production profile run passed **all five profiles** at the
unchanged 250 ms budget. Early fixture defects were corrected:
the saved text draft is authoritative after ACK, relation confirmation is accepted,
percent requests follow the real numeric-string/empty-string API contract, and
touch targets use later entity columns to genuinely reach the viewport edge.

The final full-spec production JS asset was `index-B6nYUFhp.js`, SHA-256
`1d6afa3900cbf2cd7292552e3ec8aeaa6bf9fa63e705d9eec6c28616f87bc6e2`.
These are individual runs on local headless Chromium with one worker, not
statistical guarantees:

| Editor | First pointer → paint | Reopen pointer → paint | First / reopen wall | Result at 250 ms |
| --- | ---: | ---: | ---: | --- |
| Original select | 72.6 ms | 68.9 ms | 380 / 396 ms | Pass |
| Percent-list | 151.2 ms | 102.3 ms | 531 / 439 ms | Pass |
| User | 78.4 ms | 79.2 ms | 357 / 397 ms | Pass |
| System status | 79.1 ms | 115.4 ms | 356 / 620 ms | Pass |
| Relation | 47.5 ms | 53.6 ms | 476 / 426 ms | Pass |

The final matrix scopes locator assertions to option nodes and waits for the
browser-owned paint probe before further polling. Earlier global accessibility
polling traversed all 200 rows and inflated measured paint latency, especially
for relation; those inflated timings are not this baseline.
With the same corrected measurement fixture, the previous production bundle
(`index-DA9z3_06.js`, SHA-256
`ece6713a78945aade1ba642851912dc446791f2d76d1db5a53f4f36dfbbb6e53`)
failed system status at 295.7 / 494.1 ms and relation reopening at 273.9 ms.
Status now uses the nonmodal shared listbox; the relation picker subtree survives
same-scope projection refresh, retaining its loaded candidates across ACK.
Relation still performs candidate requests (three in the diagnostic), but
reopening no longer waits for cold hydration. Its initial cold hydration is
reported separately at 1096 ms wall time. No extra priming after ACK or budget
widening hides these behaviors.
Expected/acknowledged versions were 1 → 2 with exactly one write and no unknown
API requests/page exceptions for all four new diagnostic editor scenarios.
Console 404s are retained for the intentionally unavailable mock SSE endpoint.

The tooltip/formula fixture now explicitly supplies dashboard-read responses;
all three tests pass their fail-closed unknown-request checks as well as their
tooltip/editor/formula assertions.

Coordinate follow-up builds/browser measurements with the owning agent and run
sequentially with other heavy builds/tests stopped. Keep immutable bundle hashes
for before/after comparisons. The table records the final matrix run, not a
statistical guarantee or a claim that every editor improved in every run.
WebKit trusted-touch execution is not covered by this Chromium-CDP fixture and
must not be reported as verified. All tests are mock-only: the dedicated runner
has no API proxy/database connection, rejects escaped API calls, blocks service
workers, and rejects non-loopback targets.