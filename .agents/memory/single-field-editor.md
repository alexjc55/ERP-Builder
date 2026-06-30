---
name: Single field editor
description: FieldConfigDialog is the ONE shared entity-field create/edit form; do not fork a second one.
---

# Single field editor

`FieldConfigDialog` is the single source of truth for creating/editing an entity
field (column). It is used by BOTH the admin "Поля" page (`pages/admin/entity-fields.tsx`)
and the records-page setup mode (`EntityRecords.tsx`). It owns the whole form, the
per-role access matrix, and the create/update/delete mutations; it closes itself via
`onOpenChange(false)` and then calls `onSaved()` on success/delete.

**Why:** these two surfaces edit the same `fields` table via the same hooks
(`useCreateEntityField`/`useUpdateField`). For a long time the admin page kept its
OWN inline copy of the form, which silently drifted — it was missing dependent/cascading
config, relation page-source filter, format rules, validation rules, formula editor,
drive folders, totals colors, isPinned/wrapText/showColumnTotal, and even wrongly
excluded the `function` field type. The duplication made changes untrackable.

**How to apply:** any new per-field setting goes into `FieldConfigDialog` only.
Never reintroduce a separate field form. The admin page should remain pure "chrome"
(list, reorder via `useReorderFields`, row delete via `useDeleteField`) and delegate
add/edit to `FieldConfigDialog` (`field={editingField}`, `nextSortOrder={fields.length+1}`,
`onSaved={invalidate}`). Row-level delete in the page is fine — it calls the same
`useDeleteField` mutation, so it is a second entry point, not a forked form.
