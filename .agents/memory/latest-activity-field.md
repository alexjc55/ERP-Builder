---
name: Latest activity field
description: Meaning and privacy boundary of the derived record activity field.
---
The user requested a read-only activity field for tables and Kanban: event kind
and date/time, excluding ordinary record edits. Status changes count regardless
of whether the entity's activity module is enabled; interactions count only
when it is enabled. Edits/deletions of interaction text are not new contacts.

**Why:** Staff need a visible indication of the last meaningful action without
opening each record, not a generic updated-at timestamp.

**How to apply:** Derive from actual activity occurrence times and the status
timestamp, never updatedAt. Respect field hiding and record scope; expose no
note text, actors or historical status names in this summary. Batch reads and
invalidate table views without incrementing record CAS for activity-only changes.
