---
name: System administrative pages
description: Administrative menu identity and allowed customization.
---
Administrative pages and their group must stay reachable: users may customize names, descriptions, icons, order and default expansion, but cannot delete, disable, repurpose or move them. Role permissions, not page activation, determine access.

**Why:** The user pointed out that deleting administration removes the UI needed to restore it, and approved protecting it while retaining menu customization.

**How to apply:** New administrative page seeds/migrations must mark system identity explicitly. Never infer protection from a translated name; route-based recognition is only for migration of legacy rows. No writable API may remove that identity or bind a business entity to these pages.