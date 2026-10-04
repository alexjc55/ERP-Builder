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
and click-to-visible-form separately. If most time remains before response,
investigate production connection/pool/query/network timings rather than
weakening template freshness or access checks.

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