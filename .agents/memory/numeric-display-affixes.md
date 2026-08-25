---
name: Numeric display affixes
description: Cross-surface rules for plain text shown before or after number and numeric formula values.
---

Numeric value affixes are display-only metadata for `number` and numeric `function` results. Keep the stored value, formula result, filters, sorting, and aggregates numeric. Unsupported field types must not retain affix metadata.

**Why:** Concatenating the text into the value breaks arithmetic and query behavior. Physical left/right positioning also fails under Hebrew RTL, and some pivot/dashboard surfaces do not otherwise have the source field configuration available at render time.

**How to apply:** Store semantic `before`/`after`, render the already-formatted numeric token separately with LTR isolation inside a direction-inheriting inline container, and apply the affix only when a formula result is actually numeric. Any new aggregate surface must carry the display metadata alongside its numeric result rather than changing the number.