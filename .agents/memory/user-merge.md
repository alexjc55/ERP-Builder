---
name: User account merge (duplicates)
description: How the superAdmin merge-duplicate-users endpoint repoints references and why auth now checks account liveness.
---
- POST /users/merge (superAdmin only): merge duplicate accounts into a target; sources are hard-deleted (FK cascade drops their user_roles + guest_links).
- One tx rewrites every stored reference: user-type field values in entity_records.values_json AND page_record_values.values_json (scalar number / numeric string / array with dedupe — type of each element preserved), automation conditions/actions literal `value`s whose sibling fieldKey is a user field, plus plain columns audit_log.user_id, login_history.user_id, deleted_files.deleted_by, guest_links.created_by.
- Perf: candidate rows are prefiltered in SQL with a word-boundary regex on values_json::text (`\m(id1|id2)\M`) — never load whole entities.
- Guards: target ∉ sources, cannot merge your own account, sources must not hold ANY privileged role (full role set primary+user_roles via isPrivilegedRole). Target inherits sources' non-privileged roles additively.
- **Why auth changed:** JWTs outlive account deletion/blocking. requireAuth now verifies the account exists and is_active via a 60s in-memory cache (isUserAlive); delete/block/unblock/merge call invalidateUserAliveCache so revocation is immediate on that process.
- system_events payload actorUserId is deliberately NOT rewritten (historical log).
