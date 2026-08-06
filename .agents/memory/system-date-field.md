---
name: System date field type (created_at)
description: Read-only field type backed by the entity_records.created_at system column — the pattern for system-column-backed field types.
---

# created_at field type

A field of type `created_at` ("Системная дата") has NO stored value in valuesJson; its value IS `entity_records.created_at`.

**Rules that must stay consistent:**
- **Reads**: server injects the ISO timestamp into `valuesJson` at response time (`presentRecord` in records.ts — wraps stripHidden, so field-hidden RBAC is applied FIRST; only visible created_at keys are injected). Every record read path must go through it.
- **Writes**: `cleanRecordValues` drops the key (like function/relation/lookup); automations/page-field validation rejects it as a set_field / mapping target; page-local fields of this type are rejected outright (a page value would be an unrelated user value under a system type).
- **Filter/sort/exclude/filter-values/grouping** must target the system column, not valuesJson: filters cast via `to_char(created_at at time zone 'UTC', ISO)` with datetime semantics; sort orders by the column + same-direction id tie-break (bulk imports share one timestamp); filter-values and group-by bucket by UTC DAY (`YYYY-MM-DD`); group common-value pass injects the timestamp into row values before tracking.
- **Pivot/dashboard/calendar/formatting**: pivot treats it as a date dim (PIVOT_DATE_TYPES incl. created_at; entity branch swaps in createdAtTextExpr; page-local rejected); dashboard chart group-by/table/record-source look up the field type and read the system column (day bucket for charts); calendar allows it as a date field (value arrives injected in valuesJson); conditional-formatting comparisons parse ISO-prefixed strings as timestamps (works for date/datetime too).
- **Config guards**: isKey and lockAfterCreate are rejected on BOTH create and update paths (update path uses nextType — conversion to created_at must also trip them); non-importable on both server and client.
- **Why:** any surface that reads valuesJson directly will silently show empty for this type; any write surface not dropping it could persist a fake "creation date".
- **How to apply:** when adding a new record-rendering or record-writing surface, treat `created_at` like function/lookup (derived, read-only) but source the value from the system column. FieldType is a real enum in openapi.yaml — new types require codegen (`lib/api-spec` pnpm codegen).
