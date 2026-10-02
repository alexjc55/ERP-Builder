---
name: Kanban requirements
description: User requirements for a future reusable Kanban entity view, not yet an implementation commitment.
---

**Rule:** The first intended use is the future CRM section, but Kanban must be universal and reusable for any existing or future section.

**Rule:** Allow hiding final-status columns for both successful and unsuccessful outcomes to prevent accumulated card tails. Existing archiving must also have a place in Kanban.

**Rule:** Dragging must feel immediate, without waiting for a card to jump after a server response. Account for both vertical and horizontal scrolling; horizontal scrolling must remain accessible within the viewport without scrolling through all cards first.

**Rule:** Card information must be flexibly configurable. Viewing all record information without editing and opening a record for editing must be separate actions.

**Rule:** More dynamic card configuration and behavior can be worked out once an initial Kanban exists.

**Why:** The user explicitly supplied these requirements while discussing the proposal, not as criticism or an instruction to start implementation.

**How to apply:** Carry these constraints into subsequent design and implementation. Do not specialize the view for CRM or conflate hidden columns with archived records. Discuss further card behavior after a working initial version exists.