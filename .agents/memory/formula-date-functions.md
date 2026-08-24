---
name: Formula date functions
description: Calendar-day and current-date semantics for function fields.
---

# Formula date functions

Date formulas calculate signed **calendar-day** differences, not elapsed 24-hour durations. Date and datetime inputs must be complete, valid ISO values; empty or malformed operands produce `null`. A reversed range remains negative.

**Why:** elapsed milliseconds create fractional or off-by-one results around time-of-day and daylight-saving changes, while accepting only a valid prefix lets corrupted datetime strings silently calculate.

**How to apply:** derive the day ordinal from the validated leading civil date. Resolve `today()` from the singleton application IANA time zone (default `Asia/Jerusalem`) and pass it as explicit evaluator context in every server/browser execution surface—never mutable global state. Any new relative-date helper must reuse these semantics rather than `Date.parse(end) - Date.parse(start)`.