---
name: Admin impersonation ("log in as")
description: How impersonation is modeled on top of the custom JWT auth, and the boundary rules that must stay consistent.
---

# Impersonation

An admin (superAdmin OR the `admin.users` capability) can "log in as" another user. It is built on the existing custom email/password JWT auth — no separate session table.

**Model:**
- The issued JWT carries an optional `impersonatorId` (the original admin's user id). The token otherwise *is* the target user's token, so all per-request permission loads resolve to the target — impersonation gets the target's real access, not a blend.
- `UserProfile` exposes an optional `impersonator {id,name}` (resolved from `impersonatorId`) in login/me/updateMe/impersonate responses; the client shows a banner + "return" action when set.

**Boundary rules (server is the hard boundary):**
- Gate: only superAdmin or `admin.users` may impersonate.
- No escalation: a non-super admin cannot impersonate a user whose role is superAdmin (403). The UI also hides the button for super targets when the actor is non-super, but the server check is the real guard.
- Nested impersonation preserves the **original** admin: `originalAdminId = req.user.impersonatorId ?? req.user.userId` — impersonating again while already impersonating keeps the first admin as the one you return to.
- `stop-impersonation` 400s if the caller is not currently impersonating.

**Client:** `switchIdentity(token)` swaps the stored token, `queryClient.clear()`s, and refetches `/me` — so impersonate/stop fully reload identity-scoped data rather than leaving stale cache.
