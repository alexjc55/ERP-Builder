---
name: Automation folders
description: Integrity and UX rules for grouping entity automations.
---

Automation folders are entity-scoped organizational containers. An automation may be ungrouped, and deleting a folder must set its assignments to ungrouped rather than delete or disable the automations.

**Why:** Folders exist to make large automation lists easier to navigate; they must never become a lifecycle boundary that risks losing active rules.

**How to apply:** Validate folder ownership whenever assigning an automation, serialize reorder writes, keep an explicit ungrouped section, and preserve multilingual names, RTL layout, keyboard labels, and existing automation permissions.