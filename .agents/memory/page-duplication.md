---
name: Page duplication scope
description: Copy configuration only, preserve record identity and do not grant new role access.
---

Copying a page means copying its configuration and page-owned definitions, not creating another entity or duplicating business records. Entity main pages and system pages must not be copied.

**Why:** The user explicitly requested mirror-page copies with selected fields and settings, while excluding primary entity pages. Mirrors must continue to show live source records, not snapshots.

**How to apply:** Give the copy an independent address and independent page-owned configuration. Do not copy child pages, page-local values or role grants. Explain these exclusions in the confirmation dialog; role access is assigned separately to avoid accidentally widening access.
