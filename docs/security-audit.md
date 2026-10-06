# Security audit deployment and limits

Apply `lib/db/drizzle/0026_bouncy_forge.sql` before starting this API version.
This is a NEW migration in addition to session-version migration 0025.
Use the established external-server migration procedure, checking the migration
ledger first. Do not blindly replay all historical Drizzle migrations on the
FastPanel database, whose earlier schema changes were applied manually.

Update API and frontend together. Seed new translations:

```sh
corepack pnpm --dir scripts run seed-translations --prefix=securityAudit.
```

No encryption secret or existing machine key needs to change. Existing user JWTs
remain valid if their session version remains current; new JWTs have a random
identifier so two logins in the same second no longer share an evidence reference.

## What is recorded

HTTP authentication successes/failures, 401/403 and API 404 responses; critical
user/role/agent/integration/Google configuration changes; guest-link actions,
impersonation and session revocation. Logs are available at Events → Security to
non-impersonated, non-guest human super-admins only. Acknowledging an alert does
not delete or rewrite its evidence. There is no application delete endpoint.

Request bodies, passwords, secrets, Bearer tokens, OAuth codes, query strings and
arbitrary unmatched paths are NOT retained. Session references are keyed hashes,
not usable credentials. Details label **requested** changes, not a transactional
before/after database diff. Browser data is a coarse browser-family label.

A critical request must persist an attempt before its handler runs. Completion
is a separate append. An attempt without completion is explicitly inconclusive:
it may have failed or committed before a process crash. Completion persistence
failures emit sanitized structured server-log evidence. This is not an atomic
database change journal and not a tamper-proof log against a DB/server owner.

Inbound HTTP 202 means intake/queue acceptance, NOT successful business-data
creation. Follow the saved deliveryId into the inbound-delivery history for
processing results. Identity is only attributed after credential validation.

Warnings include successful critical configuration/account changes, denied
access, repeated failed login (at least five within ten minutes for the same
submitted login), and a successful login after such failures. No automatic
blocking is implemented. In-app warnings poll every 30 seconds and require the
app to be open; external notifications are not configured.

## IP provenance — configure on the external server

By default, only the socket peer address is trusted. Behind nginx that may be
nginx's address, not the visitor's. No existing deployment is silently switched
to trusting forwarded headers.

After verifying the nginx upstream, firewall, and forwarding configuration, set
`SECURITY_TRUSTED_PROXY_CIDRS` to the exact proxy IPs/CIDRs, comma-separated.
For example, loopback addresses may be appropriate ONLY if nginx connects over
loopback and that topology has been verified. Never configure `0.0.0.0/0` or
`::/0`. Restart the API after this environment change.

The resolver starts at the socket and walks X-Forwarded-For from right to left,
only through trusted proxy hops. It ignores untrusted or malformed forwarded
chains. Peer address, selected client address and provenance are stored separately.
An IP is not a person's identity. Ensure API and PostgreSQL ports are not directly
Internet-accessible; this change does not configure the external firewall.

## What remains outside this feature

Events before deployment cannot be recovered from these tables. Direct SQL,
SSH, PM2 and server-file changes bypass HTTP auditing (including a manual password
recovery command). Configure separate protected OS/PostgreSQL auditing and ship
sanitized evidence off-server if needed. Avoid logging SQL parameters, passwords,
tokens or raw OAuth/webhook payloads.

There is no automatic retention deletion. Capacity and a retention/export policy
must be monitored; an attack can generate substantial audit volume. Separate
rate limiting, administrator MFA, step-up authorization for privileged changes,
off-server alerts and external-server hardening remain additional protections.
