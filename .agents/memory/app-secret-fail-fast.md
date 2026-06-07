---
name: App secret fail-fast
description: Why the app secret used for JWTs and at-rest encryption must never fall back to a default, and where it is enforced.
---

# App secret fail-fast

`SESSION_SECRET` is the single secret used for (a) signing all auth/OAuth-state
JWTs and (b) deriving AES-256-GCM keys for secrets at rest (Google Drive own
client secret + refresh token).

**Rule:** never fall back to a hardcoded default like
`process.env.SESSION_SECRET ?? "dev-secret-..."`. A predictable key makes
at-rest ciphertext decryptable and OAuth-state / auth JWTs forgeable.

**Where enforced:** `artifacts/api-server/src/lib/secret.ts` reads the env once,
throws at module load if it is missing/empty, and exports `APP_SECRET`. All
secret consumers (`jwt.ts`, `crypto.ts`, the Drive OAuth-state signing in
`routes/google-drive.ts`) import `APP_SECRET` — do not re-read the env or
reintroduce a fallback in those (or new) files.

**Why:** an architect review flagged the silent fallback as a serious security
hole; fail-fast at startup is preferred over silently degrading to an insecure key.

**How to apply:** any new code that signs/verifies a JWT or encrypts/decrypts a
secret must import `APP_SECRET` from `lib/secret`, never `process.env.SESSION_SECRET`
directly.
