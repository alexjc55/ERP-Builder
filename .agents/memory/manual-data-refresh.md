---
name: Manual data refresh
description: Contract for refreshing the current ERP page without browser reload.
---

The shared refresh control must refresh all active query-backed data and every mounted read path implemented through mutations or local loaders.

**Why:** Refetching the query cache alone leaves record tables and custom pivot loaders stale, while overlapping clicks or completion after navigation can duplicate work or update an unmounted screen.

**How to apply:** Any new mutation-backed read surface must register a lifecycle-safe refresh task. Coalesce overlapping global refreshes, preserve the current filters/sort/pagination, and invalidate request tokens on cleanup so stale responses cannot win.

For page status-selection settings changed by another administrator, active collaboration sessions refresh page metadata automatically. The global “Refresh data” control remains a fallback; a Kanban-only lane refresh is not a substitute for refreshing page metadata.

**Why:** Page policy affects rows, lanes, filters and change destinations together; refreshing records alone cannot update every affected control. Notifications are opaque and authorization-checked; policy values come from the normal authenticated metadata request.

**How to apply:** Revalidate metadata on both configuration notifications and connection snapshots so offline gaps heal. Keep configuration invalidation independent of batched record notifications, and include policy in render/request generations. Test automatic and manual paths with selected/empty/all, destination-only changes, and a held old response.