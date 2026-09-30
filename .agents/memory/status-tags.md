---
name: Global status tags
description: Shared tag registry semantics, permission composition, and safe configuration references.
---

**Rule:** Tags are global reusable metadata; initial applicability is statuses. Record membership derives from its current status, not copied record tags or historical status events.

**Why:** The user wants shared production/delivery/etc. categories across entities without maintaining duplicate catalogs, with room for future explicitly scoped applicability.

**How to apply:** Keep each entity's permissions independent. Widget tag selection is OR within tags and AND with direct status filters, counting each matching record once.

**Rule:** Expand each view-granting role's tag restrictions to concrete status IDs before applying most-permissive role intersection.

**Why:** Intersecting tag IDs first is incorrect when different tags share statuses. Direct status restrictions and tag-derived restrictions must compose within each role.

**How to apply:** Preserve picker/write restrictions separately from hard row visibility. Refresh effective client permissions after assignment changes; server checks remain authoritative.

**Rule:** Removing a referenced tag must fail, and deletion must serialize with role/widget JSON reference validation and persistence.

**Why:** JSON references lack foreign keys; an unlocked check-then-delete can leave committed dangling restrictions during concurrent admin edits.

**How to apply:** Keep reference checks and writes in the shared transaction-lock boundary. Renames preserve stable IDs; never silently detach references to make deletion succeed.

**Rule:** A status can hide its displayed tags or display one preferred assigned tag; without a preferred tag it displays all. These are presentation preferences only.

**Why:** Compact status cells must not change the category membership used by access restrictions, filters, or widgets.

**How to apply:** Preserve all assignments regardless of display mode, derive visible tags centrally, and clear the preferred choice when its assignment is removed.

**Rule:** Render display tags as small neutral text above the full status name, not colored chips beside it. Allow the status name to wrap instead of truncating it.

**Why:** The user found side-by-side chips consumed status width and pale tag colors disappeared against tinted cells.

**How to apply:** Keep the tag caption contrast independent of the tag color; use tight line heights rather than ellipsis or fixed-height clipping to keep cells compact.