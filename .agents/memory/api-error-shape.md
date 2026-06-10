---
name: ApiError shape (custom-fetch)
description: How server error messages reach the client and where the parsed body actually lives.
---

## Where the server error message lives on a thrown client error

The generated React Query client throws `ApiError` (lib/api-client-react/src/custom-fetch.ts).
The parsed JSON response body is exposed on **`err.data`**, NOT `err.response.data`.
`err.response` is the raw `fetch` `Response` object and has no `.data` property.
`ApiError.message` is a prebuilt human string ("HTTP 400 Bad Request: <server error>").

**Why it matters:** the erp-platform `extractError` helpers historically read
`err.response?.data?.error`, which is always `undefined` → every server validation
message (e.g. required-field errors) was silently dropped and toasts showed only a
generic title with no description. The bug was duplicated across ~9 files.

**How to apply:** to surface a server error on the client, read `err.data.error`
(the API returns `{ error: string }`), then fall back to `err.message`. Do NOT read
`err.response.data`. If you add a new error toast, reuse the same extraction shape.

## Server-side user-facing validation messages

Records validation (`validateValues` in api-server records.ts) is user-facing in this
Russian app. Required-field errors use `fieldRuName(field)` (ru→en→he→key) and are
phrased in Russian, not the raw `fieldKey`. Keep new user-facing validation messages
localized + display-name based, not key-based.
