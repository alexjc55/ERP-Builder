---
name: Kanban requirements
description: Product constraints for the reusable CRM-first Kanban entity view.
---

**Rule:** The first intended use is the future CRM section, but Kanban must be universal and reusable for any existing or future section.

**Rule:** The user wants to split one entity with many statuses across staff pages, each showing only its selected statuses in table rows, Kanban columns, and status filters. Status-change dropdowns follow that selection by default, with an explicit page-level opt-out. “Show hidden” must not reveal statuses outside that page's selection.

**Why:** Employees should monitor their own statuses. The existing soft hiding is intended for terminal statuses and must remain separate and unchanged.

**How to apply:** Reuse existing entity records and page functionality; do not treat the page selection as the existing optional hidden-status filter. Alongside the page's status selection, offer an option to show all statuses in status-change menus, applicable only in selected-status mode. This expands change destinations, not visible rows, columns, or filter options, and never bypasses existing permissions or workflow rules.

**Rule:** The default departmental handoff uses a shared status included on both pages. Optionally, a page can allow choosing destinations outside its visible set.

**Why:** The user specified “КП подписано” as a status visible in sales and as the first status in contracting. Sales moves a project there; contracting sees it and moves it through its own statuses, at which point it disappears from sales.

The user subsequently requested the all-destinations option because this is a universal product and some pages may need direct handoff to a status outside their visible set.

**How to apply:** Allow overlapping page status sets. The shared-status record remains visible on both pages until its status leaves one page's set; it is the same record, not a copy.

**Rule:** The status-coloured title hover option also applies to the eye and pencil icons on hover.

**Why:** The user explicitly requested that these actions match the title instead of remaining blue.

**How to apply:** Keep all three hover colours consistent under the same option; preserve ordinary blue when disabled.

**Rule:** Show «Без статуса» only when the entity explicitly permits no status, including when legacy null-status records exist.

**Why:** The user clarified that the disabled option must hide the column, not merely prohibit moving cards into it.

**How to apply:** Unknown metadata is not permission. Preserve old records without changing their statuses; apply the column rule to every entity, not just CRM.

**Rule:** Configure hiding on the entity status itself, analogous to its existing archiving option, rather than choosing hidden columns per Kanban view. A hidden status's Kanban column is hidden automatically. This covers both successful and unsuccessful final statuses; the user also wants the principle usable in ordinary tables to hide records with a given status. Existing archiving must also have a place in Kanban.

**Rule:** Dragging must feel immediate, without waiting for a card to jump after a server response. Account for both vertical and horizontal scrolling; horizontal scrolling must remain accessible within the viewport without scrolling through all cards first.

**Rule:** Card information must be flexibly configurable. Viewing all record information without editing and opening a record for editing must be separate actions.

**Rule:** With a mouse, users expect to drag from the card body, not only a special grip, without selecting text across the board. Clickable titles must look interactive (pointer cursor and hover colour).

**Why:** The user found grip-only mouse interaction unintuitive and reported unwanted text selection while moving cards.

**How to apply:** Preserve whole-card mouse dragging alongside title clicks; keep touch scrolling usable rather than blindly applying mouse gesture prevention to touch.

**Rule:** Card titles change colour on hover without underlining. Provide explicit view/edit buttons at the bottom trailing corner (right in LTR cards, left in RTL cards); editing remains permission-gated.

**Why:** The user approved explicit actions for discoverability and explicitly rejected hover underlining.

**Rule:** Optional status-coloured title hover should darken light status colours for readability on white cards; without a status use neutral dark grey. Keep ordinary blue hover when disabled.

**Why:** The user approved trying the proposed contrast-safe status-colour hover and requested a Kanban setting for it rather than a forced global change.

**Rule:** Card direction controls the entire card layout, including grip, menu and footer actions, not just text. Field text overrides remain strongest: field → card → page → ERP → UI language. Board column order is unaffected.

**Why:** The user clarified that RTL text inside an LTR card looks wrong: choosing RTL must mirror the card itself. Keeping field overrides strongest preserves the existing direction hierarchy.

**Rule:** More dynamic card configuration and behavior can be worked out once an initial Kanban exists.

**Rule:** Optional status-coloured backgrounds apply to Kanban columns only, never to the cards.

**Why:** The user explicitly requested column tinting while preserving uncoloured cards, even though the reference image also decorated cards.

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