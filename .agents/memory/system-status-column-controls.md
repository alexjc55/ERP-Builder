---
name: System status column controls
description: Durable boundary between entity-owned status presentation, human status edits, and trusted system assignments.
---

The system status column is entity metadata represented by the synthetic `__status__` token. Its default label and position belong to the entity; mirror pages may override its position within their unified page column order. A legacy mirror order without the status token retains entity-based placement until an explicit reorder.

**Why:** Treating status as a fixed table appendage makes headers, totals, grouped rows, inline creation, and normal rows drift apart. Excluding status from mirror-page ordering prevented users from placing it between page-local columns; changing the entity order there also unexpectedly affected other pages.

**How to apply:** Any table surface must derive status placement from the same ordered-column sequence. Mirror-page reorder actions include status and persist page order without changing entity defaults. Existing role/page hide flags may remove the status column from display but must not alter entity status metadata.

The manual-edit policy is a hard server boundary for every explicit human status choice, including ordinary create/update and interactive import. It has no super-admin bypass. It does not block omitted/default status assignment, select-to-status mappings, workflow/system actions, automations, or trusted inbound integrations.

**Why:** UI-only disabling is bypassable, and an overlooked human write surface (such as import) defeats an entity-wide restriction. Conversely, applying the restriction to trusted consequences would break configured business logic.

**How to apply:** Classify the origin of a status assignment before enforcing the policy. Mirror the result cosmetically in every human UI, but keep the server check authoritative.