---
name: RTL table borders & sticky header
description: Why table cell separators vanish in Hebrew (RTL) and on sticky headers, and the fix pattern.
---

## Pinning semantics across languages

**Rule:** Column pinning is a language-independent page setting. Switching languages must preserve it, with the frozen edge mirrored to the reading-direction start.

**Why:** The user expects a column pinned in Russian to remain pinned in Hebrew, not require separate configuration.

**How to apply:** Treat the selection column and pinned data columns as one ordered frozen region in either direction; language changes must not rewrite page settings.
Rule: table cell separators must use logical `border-inline-end`, never physical `border-right`, and a sticky header row inside a `border-collapse` table must paint its own separators with an inset box-shadow (direction-flipped under `[dir="rtl"]`).

**Why:** two independent failures observed on the records table in Hebrew:
1. With `th:not(:last-child){border-right}` under RTL, the boundary next to the visually-first column belongs to the DOM-last cell, which the selector excludes — one grid line silently disappears.
2. With `border-collapse: collapse`, borders belong to the table layer; a `position: sticky` thead scrolls away from them, so the stuck header renders with no vertical separators at all.

**How to apply:** global rule in erp-platform `index.css` uses `border-inline-end`; the main records header row carries class `erp-main-header` whose `th:not(:last-child)` get `box-shadow: inset -1px 0 0 <grid color>` (LTR) / `inset 1px` (`[dir="rtl"]`). Any new sticky header row in a collapsed table needs the same treatment. Note: inline `boxShadow` on the last pinned column overrides the class shadow — that cell's divider is the frozen-boundary shadow instead, which is intended.
