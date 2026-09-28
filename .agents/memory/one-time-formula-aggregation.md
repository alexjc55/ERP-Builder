---
name: One-time formula aggregation
description: Consistency rule for group-result formulas across record lists, dashboards, and pivots.
---

One-time (`groupResult`) formula winners must be selected from the complete filtered and permission-scoped record set before any page or dashboard-table limit is applied. Apply the established suppression semantics after formula materialization: non-winners receive numeric zero.

**Why:** Dashboard and pivot use independent aggregation paths; selecting winners from only displayed rows, or skipping winner selection, makes their totals disagree with record tables. Grouping references can also leak hidden fields unless resolved only against the caller's authorized field set. Relation/lookup grouping fields are derived inputs, so reading only stored values makes every row look ungrouped.

**How to apply:** Every formula-bearing record/dashboard/pivot path must validate entity/page grouping references against its effective field boundary, materialize entity/page inputs (including system dates and relation/lookup fields referenced only by groupResult), and retain those internal linked inputs through winner selection even though presentation strips them. Compute winners on the full set, then paginate or aggregate.

## Formula totals versus explicit measures

Table column totals may evaluate a formula over aggregated source values rather than add its per-row results. This must not override explicitly configured dashboard or pivot measure aggregations.

**Why:** The user needs overall production completion (total produced / total planned), not an unweighted average of order percentages. Dashboard/pivot measures have a separate user-selected aggregation; silently replacing that would change existing reports.

**How to apply:** Keep table total settings backward-compatible by default and use the full filtered, authorized set for flat and group totals. Preserve the distinction between averaging row results and evaluating a formula after aggregating its inputs.