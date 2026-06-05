---
name: Passwordless guest access
description: How shareable-link guest sessions work and the invariants that keep them read-only and scoped to passwordless accounts.
---

# Passwordless guest access

Model: a "client" is a **passwordless user** (a `users` row with `passwordHash IS NULL`) assigned a "Гость"-style role. Existing RBAC (sidebar/columns/read-only/own-rows) does all the per-client shaping — guest access added no parallel permission system. Entry is via an unguessable shareable link that mints a guest JWT (same mechanism family as impersonation, but no password).

## Invariants (enforced server-side — do not rely on UI)

- **Read-only is a hard boundary at `requireAuth`, not RBAC.** A token carrying `guest:true` may only make read-safe requests: any `GET`, or `POST .../records/query`. Everything else → 403, regardless of what the role's `permissionsJson` grants.
  **Why:** the guard must hold even if a Guest role is ever misconfigured with write/admin caps.
  **How to apply:** when adding a new *read* endpoint that guests must reach, it must be a GET or match the `/records/query$` path test, or extend `isGuestReadSafe`. Adding a mutating endpoint needs no change — it's denied by default.

- **A guest "read" must have zero write side-effects.** The records list/query endpoints normally run an auto-archive *write* sweep before returning rows; this is skipped for guest sessions (`req.user?.guest`). Non-guest reads still keep archival current.
  **Why:** otherwise a guest GET silently mutates data, breaking the read-only guarantee.
  **How to apply:** any future "lazy on read" write (counters, last-seen, archival, materialization) must be gated `if (!req.user?.guest)`.

- **Guest links bind to passwordless accounts only**, checked at BOTH create and redeem. Create rejects a target whose `passwordHash` is non-null (400); redeem treats any non-null `passwordHash` as an invalid link (401).
  **Why:** a credentialed/privileged account must never be reachable through the passwordless, read-only guest path. Redeem re-checks (not just create) so that if a password is later set on an account, all its existing links die immediately.

- **Passwordless accounts cannot use the password paths.** Login and change-password reject users with a null `passwordHash`.

## Operational notes

- Link tokens are stored only as a SHA-256 hash (`guest_links.tokenHash`, unique). The plaintext URL is shown to the admin exactly once at creation and never retrievable again. Redeem validates: token hash match → not revoked → not expired → user active → user passwordless.
- Redeem stamps `lastUsedAt` and writes a `login_history` row (best-effort).
- `/auth/me` returns `isGuest` so the client can render a guest banner and hide credentialed-only affordances.
