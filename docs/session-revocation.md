# Session revocation deployment

This release adds `users.session_version` through the canonical Drizzle migration
`lib/db/drizzle/0025_bizarre_xorn.sql`. Deploy the schema **before** starting the new API.
For the external server, first check its migration ledger against the repository;
use the established migration procedure. Do not blindly run historical migrations
against a database previously managed using schema push.

Every pre-release user JWT is intentionally rejected because it has no session
version claim. Users must log in again. This is an intentional security boundary,
not a backward-compatible token upgrade. `SESSION_SECRET` is unchanged and stored
Google OAuth credentials remain decryptable.

Settings → Session security:
- Every non-guest, non-impersonated user can terminate all their own sessions.
- Only a non-impersonated super-admin can terminate all user sessions.
- Both actions include the session making the request and require confirmation.
- Password change and administrative password reset atomically increment the
  account's session version with the password update.

Validation reads current session versions from PostgreSQL for every authenticated
JWT request. There is no stale-allow cache. Impersonated sessions bind both the
target and original administrator's session versions. Login uses the same version
snapshot as password verification; impersonation exit cannot upgrade an old
session to a new version.

HTTP requests authenticated after revocation are rejected. Requests that already
passed authentication are not cancelled. Collaboration streams re-run authentication
before subsequent events and heartbeat (normally within 20 seconds when idle).

This does **not** revoke AI-agent keys, inbound integration keys or guest links.
Guest JWTs are revoked, but valid guest links can issue new read-only JWTs.
Rotating compromised machine keys, revoking guest links, reviewing accounts and
restoring passwords remain separate incident-response operations.

Local verification:
`NODE_ENV=test REPLIT_ENVIRONMENT=development corepack pnpm --filter @workspace/api-server run test:user-sessions-db`

The HTTP/database tests use a temporary isolated schema, including the global
logout scenario. They never revoke real users' sessions. Production is refused.
