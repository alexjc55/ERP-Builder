---
name: Security audit purpose and limits
description: Forensic access-chain reconstruction, evidence boundaries and prevention rollout requirements.
---

The user wants to reconstruct how administrative access was obtained, not merely
see which account performed the final action. Link authentication, session,
agent/integration identity and privileged mutations; distinguish authenticated
identity from an unverified token's claims.

**Why:** An actor account ID does not identify the human who used its credentials.
The user explicitly distinguishes investigation from prevention.

**How to apply:** Never treat an IP or account ID as proof of a person's identity.
Trust forwarded IPs only after explicit proxy-topology configuration, not by
default. Never retain credential values in evidence. Review/acknowledgment must
not erase evidence. Explain that HTTP evidence does not cover direct SQL/SSH or
recover unlogged past activity. An incomplete request is not proof of rollback.
Administrator MFA and step-up protections need an enrollment/recovery path
before enforcement; do not silently lock the owner out.
