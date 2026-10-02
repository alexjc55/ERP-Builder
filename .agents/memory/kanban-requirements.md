---
name: Kanban requirements
description: Product constraints for the reusable CRM-first Kanban entity view.
---

**Rule:** The first intended use is the future CRM section, but Kanban must be universal and reusable for any existing or future section.

**Rule:** Configure hiding on the entity status itself, analogous to its existing archiving option, rather than choosing hidden columns per Kanban view. A hidden status's Kanban column is hidden automatically. This covers both successful and unsuccessful final statuses; the user also wants the principle usable in ordinary tables to hide records with a given status. Existing archiving must also have a place in Kanban.

**Rule:** Dragging must feel immediate, without waiting for a card to jump after a server response. Account for both vertical and horizontal scrolling; horizontal scrolling must remain accessible within the viewport without scrolling through all cards first.

**Rule:** Card information must be flexibly configurable. Viewing all record information without editing and opening a record for editing must be separate actions.

**Rule:** With a mouse, users expect to drag from the card body, not only a special grip, without selecting text across the board. Clickable titles must look interactive (pointer cursor and hover colour).

**Why:** The user found grip-only mouse interaction unintuitive and reported unwanted text selection while moving cards.

**How to apply:** Preserve whole-card mouse dragging alongside title clicks; keep touch scrolling usable rather than blindly applying mouse gesture prevention to touch.

**Rule:** More dynamic card configuration and behavior can be worked out once an initial Kanban exists.

**Why:** The user supplied these requirements and then authorized implementation of the agreed first version.

**How to apply:** Carry these constraints into subsequent design and implementation. Do not specialize the view for CRM or conflate hidden columns with archived records. Discuss further card behavior after a working initial version exists.

**Rule:** Pagination must bound the work per column without imposing a total-card cap. Status moves reuse the existing workflow/CAS update path; late results from an earlier query must not restore cards after filters change.

**Why:** A hard cap would leave older records inaccessible, while delayed optimistic rollback can otherwise put records into a view whose filters they no longer match.

**How to apply:** Keep all pages reachable, use query-generation guards for reads and mutation completions, and preserve pending overlays during same-query live refresh.

**Rule:** A drag gesture owns the exact event handlers registered at its start; ordinary layout rerenders must not cancel it.

**Why:** Horizontal autoscrolling caused a rerender and callback-identity change that triggered effect cleanup, terminating the drag before drop.

**How to apply:** Clean up the captured gesture on cancellation, query-scope change or unmount, not on changing callback identity. Retain real-pointer horizontal-autoscroll regression coverage.

**Rule:** After a conflicting Kanban move, refresh every current lane, not only the losing move's source and destination.

**Why:** A concurrent winner can move the card into a third lane. An SSE refresh during the losing pending move hides that authoritative card behind the optimistic overlay; two-lane refresh then leaves it missing.

**How to apply:** Exercise a three-lane conflict with two real sessions and an SSE refresh while the losing write is pending; verify the winner's card and counts after rollback.