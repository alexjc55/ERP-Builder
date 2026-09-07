---
name: Manual data refresh
description: Contract for refreshing the current ERP page without browser reload.
---

The shared refresh control must refresh all active query-backed data and every mounted read path implemented through mutations or local loaders.

**Why:** Refetching the query cache alone leaves record tables and custom pivot loaders stale, while overlapping clicks or completion after navigation can duplicate work or update an unmounted screen.

**How to apply:** Any new mutation-backed read surface must register a lifecycle-safe refresh task. Coalesce overlapping global refreshes, preserve the current filters/sort/pagination, and invalidate request tokens on cleanup so stale responses cannot win.