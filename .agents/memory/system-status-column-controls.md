---
name: System status column controls
description: Durable boundary between entity-owned status presentation, human status edits, and trusted system assignments.
---

The system status column is entity metadata represented by the synthetic `__status__` token. Its label and position belong to the entity; a missing position preserves the historical placement after entity fields. Page-local field ordering and status-column visibility overrides remain separate concerns.

**Why:** Treating status as a fixed table appendage makes headers, totals, grouped rows, inline creation, and normal rows drift apart. Mixing it with page-local metadata also makes the same entity inconsistent across pages.

**How to apply:** Any table surface that renders entity columns must derive status placement from the same ordered-column sequence. Existing role/page hide flags may remove the status column from display but must not alter entity status metadata.

The manual-edit policy is a hard server boundary for every explicit human status choice, including ordinary create/update and interactive import. It has no super-admin bypass. It does not block omitted/default status assignment, select-to-status mappings, workflow/system actions, automations, or trusted inbound integrations.

**Why:** UI-only disabling is bypassable, and an overlooked human write surface (such as import) defeats an entity-wide restriction. Conversely, applying the restriction to trusted consequences would break configured business logic.

**How to apply:** Classify the origin of a status assignment before enforcing the policy. Mirror the result cosmetically in every human UI, but keep the server check authoritative.