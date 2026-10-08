---
name: Login protection
description: Throttling decisions and rollout constraints for password login.
---
Protect login without an IP allowlist or permanently disabling accounts. Temporary
account-wide limits may also delay the legitimate owner during a distributed attack;
never promise they eliminate account-targeted denial of service.

**Why:** The user approved brute-force protection after rapid attempts against several
accounts, but needs staff to log in from different networks.

**How to apply:** Keep counters shared across API workers/restarts and bounded in storage.
Deploy the throttle-table migration before the API: unavailable protection must refuse
login, not silently bypass it. Preserve trusted-proxy IP attribution and active sessions.
Describe all-attempt limits honestly, not as failure-only limits.
