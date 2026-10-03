---
name: Manual data refresh
description: Contract for refreshing the current ERP page without browser reload.
---

The shared refresh control must refresh all active query-backed data and every mounted read path implemented through mutations or local loaders.

**Why:** Refetching the query cache alone leaves record tables and custom pivot loaders stale, while overlapping clicks or completion after navigation can duplicate work or update an unmounted screen.

**How to apply:** Any new mutation-backed read surface must register a lifecycle-safe refresh task. Coalesce overlapping global refreshes, preserve the current filters/sort/pagination, and invalidate request tokens on cleanup so stale responses cannot win.

For page status-selection settings changed by another administrator, the guaranteed freshness mechanism is the global “Refresh data” control, without browser reload. A Kanban-only lane refresh is not a substitute for refreshing page metadata.

**Why:** Page policy affects rows, lanes, filters and change destinations together; refreshing records alone cannot update every affected control. Live propagation of page configuration would be a separate feature.

**How to apply:** Cross-session tests must use the global control, exercise selected/empty/all and destination-only changes, and deliver a held old records response after the new page policy is rendered.