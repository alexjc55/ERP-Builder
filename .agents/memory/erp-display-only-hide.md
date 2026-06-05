---
name: Display-only column hide vs server boundary
description: When a UI-only hide is intentionally applied even to superAdmin while the server keeps super's full access — the two must not be conflated.
---

# Display-only hide vs the server hard boundary

In the records data table, a field whose `permissionsJson[currentRoleId] === "hidden"` hides its whole **column** even for a superAdmin. This is a **display-only** rule, deliberately separate from the security boundary.

**Why:** The user wanted hidden fields to declutter the table for everyone, including super, but super must still be able to *edit* the field. So:
- The table column list (`tableFields` in `EntityRecords.tsx`) drops role-hidden fields for everyone, super included.
- The edit dialog still uses `visibleFormFields` (driven by `fieldAccess`), which keeps super at `edit` — so super can still edit the field.
- The **server is unchanged**: `resolveFieldAccess` still grants super `edit`, so API responses are NOT stripped for super. The column hide is purely cosmetic on the client.

**How to apply:** Never implement a "display-only" preference by tightening the server, and never assume a hidden column means the value is protected from super — for super it is only hidden in that one table view. The field-access editor (`entity-fields.tsx`) intentionally lets you assign access to superAdmin roles too (`assignableRoles = roles`), purely to drive this cosmetic rule.
