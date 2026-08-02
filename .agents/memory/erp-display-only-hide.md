---
name: Display-only column hide vs server boundary
description: When a UI-only hide is intentionally applied even to superAdmin while the server keeps super's full access — the two must not be conflated.
---

# Display-only hide vs the server hard boundary

In the records data table, a field whose `permissionsJson[currentRoleId] === "hidden"` hides its whole **column** even for a superAdmin. This is a **display-only** rule, deliberately separate from the security boundary.

**Why:** The user wanted hidden fields to declutter the UI for everyone, including super. Since 2026-08 (user request) the display-only hide applies to **forms too**, not just the table:
- `visibleFormFields` in `EntityRecords.tsx` now also drops fields explicitly `hidden` for every assigned role (per-role config read directly, so super is included); `tableFields === visibleFormFields`.
- The quick-create related-record dialog applies the same predicate (it previously showed ALL fields — even inactive ones; both fixed).
- Same for **"view"**: when EVERY assigned role explicitly sets view/hidden on a field, the UI treats it as read-only even for super — `roleDisplayView`/`effFieldAccess` in EntityRecords.tsx cap `fieldAccess` at every editability site (RecordFormBody, inline cells, add-row, relation persist). Absent per-role entry = unrestricted (most-permissive union, matching the hide rule).
- The **server is unchanged**: `resolveFieldAccess` still grants super `edit`, so API responses are NOT stripped for super. The hide is purely cosmetic on the client; to let super edit such a field again, un-hide it in field settings first.

**How to apply:** Never implement a "display-only" preference by tightening the server, and never assume a hidden column means the value is protected from super — for super it is only hidden in that one table view. The field-access editor (`entity-fields.tsx`) intentionally lets you assign access to superAdmin roles too (`assignableRoles = roles`), purely to drive this cosmetic rule.
