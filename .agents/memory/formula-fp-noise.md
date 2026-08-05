---
name: Formula FP-noise policy
description: 12-significant-digit cleanup for formula results without configured decimals; per-row-before-sum consistency rule
---
- Rule: when a formula/number field has NO `decimals` configured, every displayed or aggregated result must pass `cleanFpNoise` (lib/formula, `toPrecision(12)`), applied PER ROW before summing AND on the final aggregate.
- **Why:** binary FP noise (71.63*110 = 7879.299999999999) leaked into cells; and totals must equal the sum of visible cell values (same invariant as the toFixed(decimals) path).
- **How to apply:** any new eval/aggregation site (widgets, pivots, exports) with a no-decimals numeric formula result must clean per value, not only at the end. This is a deliberate lossy 12-sig-digit policy (spreadsheet-style) — acceptable for business data.
