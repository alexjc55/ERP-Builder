---
name: Session revocation boundary
description: Why browser-session revocation must stay independent of encrypted integration credentials.
---

Revoke browser sessions without rotating the shared application secret. Reject
legacy tokens lacking revocation metadata rather than silently upgrading them.

**Why:** The same application secret also protects stored Google credentials;
rotating it as a logout mechanism would break decryption. During security
containment, preserving legacy browser tokens defeats the purpose of revocation.

**How to apply:** Keep session revocation separate from encryption and machine
API-key lifecycle. Bind impersonated sessions to both accounts. Never refresh a
session's revocation metadata from a newer database snapshot after verifying an
older credential/token. Account checks must not cache an allowed session across
processes. An already authenticated request is not retroactively cancelled.

Guest links and machine keys remain independent credentials: revoking user
sessions is not a substitute for rotating compromised integration/agent keys or
revoking guest links. State that distinction in incident-response instructions.

All long-lived browser transports should subscribe to the shared authenticated
401 notification and stop synchronously, including pending permission-recovery
timers and presence requests. A late response belongs to the token it used.

**Why:** One reader discovering invalid credentials must not leave sibling
timers running until their next request or React's next render. Network/5xx
failures are not evidence of an invalid session.

**How to apply:** Compare session identity, abort in-flight transport, unregister
listeners on teardown, and preserve re-login with a replacement token.
