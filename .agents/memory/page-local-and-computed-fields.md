---
name: Page-local fields, conditional formatting, function fields
description: Durable rules for mirror-page page-local fields, per-field conditional formatting, and the function/formula field type in the ERP builder.
---

# Page-local fields (mirror pages)

A mirror page can carry its own extra columns that do NOT live on the source
entity. These are page-scoped field definitions plus a separate per-(page,record)
JSONB value map, kept fully distinct from the mirrored entity's own field values.

- Add-column on a mirror page must write a page-local field, never a field on the
  source entity. The records table merges entity values + page values at render
  time (`allValues = { ...entityValues, ...pageValues }`), and that merged map is
  what formulas and conditional formatting read.
- Page values are stored as a whole JSONB map per (page, record); inline edits
  must merge the existing map with the single edited key before writing (deleting
  the key when the new value is empty), not overwrite the map.
- Page-local columns must look identical to entity columns (no distinct color or
  badge icon); they get the same setup-mode reorder arrows as entity columns, but
  driven by the page-fields reorder endpoint (swap sortOrder of the two neighbors).
- Creating a row on a mirror page is inherently a TWO-step write: create the
  entity record, then write its page values keyed by the new record id. There is
  no single combined endpoint — page values always live in a separate table — so
  this is non-atomic by design (same as inline page-cell edits). If step two
  fails, the record exists with empty page fields and the user fills them inline;
  surface the second-step error and keep the save control disabled while either
  mutation is pending.

**Why:** the user explicitly required page-local fields with *separate* value
storage so a mirror page can extend a shared entity view without mutating the
underlying entity or other pages that mirror it.

## RBAC is a hard server boundary on page-value endpoints (do not regress)

The page-local record-values API is NOT admin-only metadata — it carries real
record data, so it must mirror the entity records' RBAC exactly:

- Resolve the page's `mirrorEntityId` first; reject non-mirror pages (400) and
  missing pages (404). Page-local values only exist on mirror pages.
- GET record-values: require record `view` on the mirrored entity, and constrain
  results by joining to `entity_records` on `entityId === mirrorEntityId` plus the
  own-scope SQL predicate when scope is `own`. Never return rows the caller can't
  see.
- PUT record-values: verify the target record's `entityId === mirrorEntityId`
  (reject cross-entity writes — IDOR), require record `update`, and reject
  non-owned records under `own` scope (404 mask).
- GET fields-metadata mirrors the same view boundary (gate by mirrored-entity
  `view`) so column definitions aren't leaked to users who can't see the entity.
- Read-only guests are already blocked from the PUT at `requireAuth` (only GET +
  `/records/query` POST are allowed); rely on that, but still enforce per-entity
  RBAC for normal users.

**Why:** first implementation used `requireAuth` only — architect flagged a full
RBAC bypass + IDOR + bulk data overexposure. Any new page-data endpoint must
re-derive the mirrored entity and apply the entity's record/own-scope rules.

# Color pickers must be in-DOM, not native `<input type="color">`

Conditional-formatting (and any) color pickers use react-colorful's
`HexColorPicker` inside a popover, plus a hex text input — never a native
`<input type="color">`.

**Why:** the native color input delegates to the OS color dialog, which is
unreliable/blocked inside the Replit preview iframe (and cross-origin embeds):
the eyedropper is disabled and custom-color selection silently fails, leaving
users stuck on preset swatches.

**How to apply:** for any new color-picking UI in a web artifact, reach for
react-colorful (tiny, dependency-free, auto-injects its own CSS) rendered in the
DOM; keep a hex text field alongside for paste/type. Do not reintroduce
`<input type="color">`.

# Conditional formatting per field

Each field (entity field and page field) can carry `formatRulesJson`: ordered
rules with an operator + comparison value producing a cell background and/or a row
background. Formatting is computed client-side over the merged `allValues`, so a
function field's computed result and a page field's value can both drive colors.

# Function / formula field type

`function` is a computed, read-time-only field type with a `formulaConfigJson`
expression. It is NEVER stored: server validation skips `function` fields on both
the entity records path and the page-values path, and the UI renders it
non-editable (no inline edit, read-only placeholder in the add-row draft).

**Deviation / known limitation:** formulas currently resolve same-record refs
only (entity + page merged values of the same row). Cross-entity / cross-record
references are deferred (tracked as a follow-up), not implemented.

## Formula-helper chips must mirror the eval context exactly

The formula editor's clickable field chips (insert `{key}` at caret) must offer
EXACTLY the keys the evaluator can resolve, no more:

- Entity-field dialog: the entity's own fields, excluding the field being edited
  and any `function`-type fields.
- Page-field dialog on a mirror page: the merged set the evaluator sees —
  page-local non-function fields PLUS the mirrored source-entity fields — and it
  must be de-duplicated by key with **page-local precedence**, matching the
  values merge `{...source, ...page}` (a page-local key shadows a same-key source
  field). Deduping also prevents duplicate React keys on the chip list.
- Always exclude `function`-type fields from suggestions: their computed values
  are never written into the values map, so a formula referencing one resolves to
  empty.

**Why:** suggesting a key the evaluator can't resolve (e.g. a function field, or
a source key shadowed by a page-local one) produces silently-wrong formulas.

## Column totals evaluate over RAW values (including hidden fields) — by product decision

A `function`/formula field can opt into a column total (`showColumnTotal`), summed
server-side over the FULL filtered set in `records/query`. The formula total
evaluates per row over the **raw** `valuesJson`, INCLUDING fields hidden for the
viewer. Do NOT strip hidden fields before summing.

**Why:** a column total must be the *true* total. Silently dropping a hidden
field's contribution produces an under-count the viewer cannot detect — explicitly
rejected by the product owner as dangerous for financial data (a wrong sum has
serious consequences). The accepted trade-off: the aggregate may reflect data the
viewer cannot see per-row. Correctness of the total beats aggregate confidentiality
here. (This reverses an earlier strip-hidden decision — do not reintroduce the strip.)

**How to apply:** the pure evaluator lives in `@workspace/formula` (shared by
erp-platform client and api-server). Per-row results the client shows are still
computed over hidden-stripped maps (the hard per-row boundary stays), so per-row
values may not sum to the displayed total — that inconsistency is intended.

## Page-local (mirror-page) field totals ARE computed

`records/query` also computes totals for page-local fields when `body.data.pageId`
is set: `number` page fields sum `page_record_values`; `function`/formula page
fields evaluate over the MERGED `{...entityValues, ...pageValues}` per row (same
merge the client uses). Row-scope/own-scope/hidden-row-status are inherited via the
shared `where` (so mirror pages are covered — `where` targets the page's effective
entity). A page total is only produced when the page field is visible to the viewer
(`mostPermissiveFieldPerm(view) !== "hidden"`).

**Key collision rule:** page totals are keyed `pf:<pageFieldId>` in `numericTotals`
(NOT by `fieldKey`) so they never clobber an entity total when a page field shares a
key with an entity field. The client reads page-column totals by that same
`pf:<id>` key. `numericTotals` is a free map (`additionalProperties: number`), so
prefixed keys need no OpenAPI change — but server and client must stay in lockstep.
