---
name: Formula date functions
description: Calendar-day and current-date semantics for function fields.
---

# Formula date functions

Date formulas calculate signed **calendar-day** differences, not elapsed 24-hour durations. Date and datetime inputs must be complete, valid ISO values; empty or malformed operands produce `null`. A reversed range remains negative.

`workingDaysBetween(start, end)` uses the same calendar-day parsing and signed-range rule as `daysBetween`: exclude the start date, include the end date when it is a working day, and make a reversed range the exact negative. Working weekdays are ISO values `1..7`, passed in evaluator options with a Sunday–Thursday default (`[7,1,2,3,4]`). The separately persisted first day of week does not change formula math.

**Why:** elapsed milliseconds create fractional or off-by-one results around time-of-day and daylight-saving changes, while accepting only a valid prefix lets corrupted datetime strings silently calculate. Mutable/global workweek state would let records, reports, automations, and browser previews disagree.

**How to apply:** derive the day ordinal from the validated leading civil date. Resolve `today()` from the singleton application IANA time zone (default `Asia/Jerusalem`) and pass both `timeZone` and `workingDays` as explicit evaluator context in every server/browser execution surface—never mutable global state. Any new relative-date helper must reuse these semantics rather than `Date.parse(end) - Date.parse(start)`.

**Native-memory rule:** Reuse timezone validation results and Intl date formatters in bounded caches, including negative validation results. Never instantiate `Intl.DateTimeFormat` for each row's current-date calculation.

**Why:** A formatter cache alone was insufficient: timezone validation still constructed an ICU-backed formatter on every evaluation. An isolated repeat-call experiment reproduced substantial RSS growth with flat post-GC JavaScript heap; reusing validation eliminated most growth in that workload. This establishes a local allocation cause, not attribution of all production RSS.

**How to apply:** Cover constructor counts as well as date correctness in regression tests; bound cache cardinality and reject oversized keys before retention. Preserve timezone, DST and working-day semantics.