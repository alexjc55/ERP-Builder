---
name: Kanban requirements
description: User requirements for a future reusable Kanban entity view, not yet an implementation commitment.
---

**Rule:** The first intended use is the future CRM section, but Kanban must be universal and reusable for any existing or future section.

**Rule:** Configure hiding on the entity status itself, analogous to its existing archiving option, rather than choosing hidden columns per Kanban view. A hidden status's Kanban column is hidden automatically. This covers both successful and unsuccessful final statuses; the user also wants the principle usable in ordinary tables to hide records with a given status. Existing archiving must also have a place in Kanban.

**Rule:** Dragging must feel immediate, without waiting for a card to jump after a server response. Account for both vertical and horizontal scrolling; horizontal scrolling must remain accessible within the viewport without scrolling through all cards first.

**Rule:** Card information must be flexibly configurable. Viewing all record information without editing and opening a record for editing must be separate actions.

**Rule:** More dynamic card configuration and behavior can be worked out once an initial Kanban exists.

**Why:** The user explicitly supplied these requirements while discussing the proposal, not as criticism or an instruction to start implementation.

**How to apply:** Carry these constraints into subsequent design and implementation. Do not specialize the view for CRM or conflate hidden columns with archived records. Discuss further card behavior after a working initial version exists.