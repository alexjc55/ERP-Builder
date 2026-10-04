# Card-opening measurements and freshness

## Scope

Read-only measurements on the development application using its existing published
card. No production requests or changes were made. The server-side API fixture
suite separately creates and deletes isolated test data after verifying the
development fingerprint and HTTP/database identity.

## Same browser benchmark before and after

Milliseconds, Chromium, five create-dialog openings, no records saved.
The first visible complete form is measured at a browser animation frame after
the layout exists and the shell opacity is 1. This is not a claim that every
asynchronous field lookup has completed.

| Metric | Before samples | After samples |
|---|---|---|
| Click → visible form | 490, 508, 482, 503, 563 | 254, 67, 75, 224, 63 |
| Browser resolve request | 17, 12, 10, 12, 26 | 15, 11, 16, 22, 14 |
| Response end → visible form | 308, 196, 195, 216, 198 | 69, 20, 19, 61, 20 |

Median click-to-form: **503 ms → 75 ms**. Local network request time was not the
dominant factor. Cold direct API samples were 340 ms before / 335 ms after;
subsequent direct API samples were 24,18,12,10,20 / 13,10,8,8,8 ms.
Small samples and development-server timing vary; this is not a performance SLA.
The user's reported remote-server delay of 2–3 seconds was **not reproduced or
measured on that server**.

## Changes

- Template loading state lives inside a dialog boundary rather than causing
  repeated renders of the full records page.
- Dialog opening no longer waits for a fade animation to reach full opacity.
- Independent scope/permission and authorized template/field reads run in
  parallel, using the existing permission functions.
- Every opening still resolves live. No cross-opening template cache, TTL,
  background refresh substitution, or stale fallback was introduced.
- Closing/changing scope aborts the request and rejects late results. Known
  user/role/permission changes invalidate the open snapshot; template publication
  alone does not overwrite a user's in-progress form.
- Responses are `Cache-Control: no-store`. Successful resolutions expose
  `Server-Timing` entries `card_auth` and `card_data` to separate route permission
  work from authorized data loading. Authentication middleware, transport, JSON
  serialization and browser rendering are outside these two spans.

## Reproduce locally

Use an independently verified development metadata fingerprint; never point the
benchmark at production. It requires an active published card and an active
super-admin test reader. The script never logs tokens or form values.

```sh
NODE_ENV=development REPLIT_ENVIRONMENT=development \
CARD_PERF_DEV_FINGERPRINT=<verified-development-fingerprint> \
CARD_PERF_LABEL=after \
corepack pnpm exec playwright test tests/e2e/card-open-performance.spec.ts
```

For the remote deployment after its owner updates it, collect the browser
Network timing for `POST /api/card-templates/resolve`, its `Server-Timing` header,
and click-to-visible-form separately. If most time is spent inside the request,
investigate production connection/pool/query/network timings rather than
weakening template freshness or access checks.

## Remote follow-up observations

The live site was subsequently verified serving the updated frontend. User
screenshots of three successful resolve requests showed approximately 185/147/146
ms waiting for response, with card_auth 14/3/4 ms and card_data 15/5/5 ms.
These are screenshot readings, not a browser trace or click-to-paint measurement.
The user reports, after rebooting their computer, about 3 seconds on the first
opening and 2 seconds on subsequent openings on the remote server, visibly slower
than Replit. Therefore the remote end-to-end delay remains unresolved.

The opening handler has no awaited network prerequisite, but still updates state
in the large records component. Re-render cost before template resolution is a
hypothesis to measure, not a confirmed diagnosis. Different production data,
other concurrent requests, form construction, and browser workload remain possible.

The optional console diagnostic at scripts/measure-card-opening.browser.js opens
and closes an empty create form three times, with no save. It reports request
start relative to the programmatic click, request duration, response-to-visible
custom layout, and the route's server spans. It requires an already authenticated
browser on the target records page; never supply credentials to the script.
It measures initial layout visibility, not completion of every field lookup.
Long-task information is optional (unsupported in Firefox); it is not a CPU
profile or proof of the responsible function. A DOM visibility check at an
animation frame is only an approximation of painting.

### Measured remote phases

The user subsequently ran the console diagnostic on the remote application and
returned these numbers (milliseconds):

| Opening in this series | Total | Before request | Request | After response | card_auth | card_data |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1365 | 1176 | 158 | 31 | 10 | 5 |
| 2 | 1345 | 1152 | 167 | 26 | 5 | 3 |
| 3 | 1311 | 1118 | 167 | 26 | 4 | 6 |

Median total: 1345 ms. Median pre-request interval: 1152 ms (about 86% of
the median total). Median request: 167 ms. Median response-to-layout: 26 ms.
The two measured server spans account for 15, 8 and 10 ms; they exclude
authentication middleware and other overhead, so the remaining request duration
must not be attributed solely to network latency.

Long-task entries were unsupported in this browser. The dominant measured delay
is on the client before dispatching the template request, not inside that request
or after its response. Parent records-page rendering is a strong candidate because
the open handler changes parent state and the resolve starts from an effect, but
these measurements do not identify the exact costly function. Profile the initial
state update/render, field initialization and effect scheduling before choosing
a fix. Do not remove fresh authorization or use cached templates to hide it.

These are three programmatic openings on an already loaded page, not a controlled
cold-start run. They do not contradict the user's rough 3-second first / 2-second
repeat observation: startup, event queue delay before programmatic execution,
and later field loading are not fully covered. The diagnostic itself was checked
by the development Playwright benchmark before the user ran it; that check does
not stand in for the remote measurements above.

Outcome: remote measurement completed; the remaining opening delay is NOT fixed.
No remote source, configuration, database, or deployment was modified by the
agent. Updating the deployment and running the console diagnostic were performed
by the user.

## Regression coverage

- Slow response never exposes the standard form before the custom presentation.
- Open form stays unchanged across publication; reopening gets the new template.
- Same token gets a 403 after role revocation in the real API/database suite.
- Failed resolution shows error/retry instead of a cached form.
- Closing before response and reopening ignores the old response.
- Auth change while resolving discards the old actor's response; navigating to
  another entity gets a separate resolution.
- Existing suite covers entity/page inheritance, field projection, view/edit/
  create, related create, invalid layouts, fullscreen/side/RTL/mobile and
  preservation of typed values and selected tabs.

## Large-table optimization (local, not yet verified remotely)

A route-intercepted fixture with 200 rows and 27 fields reproduces a long
pre-request interval without touching any database. Its custom card contains two
editable fields and 40 text blocks. It uses the same phase diagnostic.

| Phase, ms | Before (three openings) | After (three openings) |
|---|---|---|
| Before request | 830, 564, 1531 | 306, 404, 373 |
| Request | 5, 6, 4 | 4, 4, 9 |
| After response | 103, 81, 91 | 87, 99, 142 |
| Total | 938, 652, 1626 | 398, 507, 524 |

Median total: 938 → 507 ms (about 46% lower). Median pre-request interval:
830 → 373 ms (about 55% lower). Development CPU timings are noisy; these three
samples establish a local improvement, not a guarantee of remote latency.

Profiling found two separate costs:

- Draft/open state was owned by the large records page. It now lives in a
  dialog-only boundary, with stable functional setters. The parent still supplies
  current metadata/permissions and retains the original mutation/invalidation
  handlers; submit receives the current draft explicitly. The boundary resets
  on entity/page changes. CAS versions and relation-driven version updates remain
  part of the existing write contract.
- Isolating React state alone did not substantially reduce the measured latency.
  Browser CPU sampling showed expensive computed-style reads in Radix presence
  and native focus. The scroll-lock library updates an inheritable body CSS
  variable; the table's independent scroll container does not need that value.
  Pinning the unused value inside this container stops its propagation through
  thousands of cells. Portals remain outside that container and still inherit
  body scrollbar compensation. Body pointer blocking, modal focus trapping,
  scroll locking and outside-click prevention were not disabled or replaced.

Layout/style containment, fixed table layout, row content-visibility and altered
pointer inheritance were investigated but not shipped. No modal library was
replaced and no reusable template/permission cache was added.

Verification:
- Frontend TypeScript passed.
- 32 card/presentation UI cases passed, including the large-table fixture and
  current-draft create/save, view→edit, conflict preservation, CAS retry and reset
  on reopening. A tooling connection interruption occurred after these cases;
  the remaining suites were subsequently run separately.
- Quick-create ancestor-lock and lookup-format test passed after its older mock
  explicitly returned `template: null` for the standard form.
- Real development relation-write/CAS/navigation test passed after its older
  fixture accepted the existing parent-change confirmation instead of silently
  dismissing it. No production database or server was used.

To repeat the large fixture and optionally collect CPU sample summaries:

```sh
corepack pnpm exec playwright test tests/e2e/card-presentation.spec.ts --grep 'large table'
CARD_PROFILE=1 corepack pnpm exec playwright test tests/e2e/card-presentation.spec.ts --grep 'large table'
```

This change is frontend-only; no API rebuild or SQL migration is required for it.
The owner still needs to update/rebuild the remote frontend before repeating the
browser diagnostic there. The recorded remote 1118–1176 ms pre-request interval
belongs to the previous frontend, not this optimization.