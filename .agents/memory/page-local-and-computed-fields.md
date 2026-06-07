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
