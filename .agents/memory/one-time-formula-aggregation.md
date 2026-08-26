---
name: One-time formula aggregation
description: Consistency rule for group-result formulas across record lists, dashboards, and pivots.
---

One-time (`groupResult`) formula winners must be selected from the complete filtered and permission-scoped record set before any page or dashboard-table limit is applied. Apply the established suppression semantics after formula materialization: non-winners receive numeric zero.

**Why:** Dashboard and pivot use independent aggregation paths; selecting winners from only displayed rows, or skipping winner selection, makes their totals disagree with record tables. Grouping references can also leak hidden fields unless resolved only against the caller's authorized field set.

**How to apply:** Every formula-bearing record/dashboard/pivot path must validate entity/page grouping references against its effective field boundary, materialize entity/page inputs (including system dates), compute winners on the full set, then paginate or aggregate. Batch full-set page and linked-source resolution without splitting winner selection.