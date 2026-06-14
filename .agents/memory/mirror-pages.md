---
name: Mirror pages (live read-through of another entity)
description: How a page can show another entity's live records with a field subset, and why mirrorFieldKeys is display-only, not a security boundary.
---

# Mirror pages

A page row can reference an existing entity via `mirrorEntityId` plus an optional
`mirrorFieldKeysJson` (string[] of field keys). The dynamic page renderer then
shows that source entity's **live** records through the normal records path, so
edits are bidirectional (same source records) — never a copy.

**Why a "mirror page" instead of copying records:** the user wanted a live
client-cabinet view of another entity. Reusing the existing records read/write
path means zero risk to the sensitive records flow and automatic bidirectional
sync. Per-client row visibility and field hiding come "for free" from the
EXISTING RBAC on the source entity.

**How to apply / invariants:**
- `mirrorEntityId` has NO FK to entities (avoids a circular pages↔entities import
  in the schema); existence is validated server-side in page create/update
  (400 "Mirror entity not found"). The renderer tolerates a dangling
  mirrorEntityId by showing an empty state.
- Mirror takes priority over a page's bound entity in the renderer.
- `mirrorFieldKeysJson` is a **DISPLAY-ONLY** projection. It narrows which
  columns render; it is NOT a security boundary. Hard field hiding must still be
  done with field-permission "hidden" for the relevant role. `EntityRecords`
  applies the visibleFieldKeys projection first, then still applies field-level
  RBAC hiding on top — the two must not be conflated.
- `mirrorFieldLabelsJson` (`Record<fieldKey, {ru,en,he}>`) is a **DISPLAY-ONLY**
  per-mirror-page label rename — e.g. show «Цена» instead of the source field's
  «Цена для производителя» — without touching the source field. It is NOT a
  security boundary: it does not hide anything (real hiding stays via field
  "hidden" RBAC), and the renamed text replaces the displayed label only.
  - **Applied once at the field source, not per call-site.** `EntityRecords`
    rewrites each field's `nameJson` to the override (when non-empty) right after
    fetching `allFields`, so every consumer (table header, filter bar, sort/view
    config, record form, dependent pickers) reflects it automatically. **Why:**
    there are ~12 label render sites; resolving at the source is the only way to
    stay complete and not drift. **Safe because** overrides arrive ONLY on mirror
    pages, where entity-column setup is suppressed (`!isMirror`), so the
    `FieldConfigDialog` never receives (and can never persist) an overridden name.
  - Override REPLACES the whole `nameJson` (not per-language merge): once any
    language is set, `ml()` falls back ru→en→he WITHIN the override so the source
    name never leaks in an unset language. An override with all-empty values is
    treated as absent (source name shows).
  - `RecordEditModal` and the related-create picker fetch a DIFFERENT (linked)
    entity's fields, so mirror-entity overrides correctly do not apply there.
  - **Where it's edited: INLINE on the mirror page, NOT in the admin page modal.**
    In `EntityRecords` setup mode on a mirror page, each column header becomes a
    button that opens a small label dialog (ru/en/he, placeholder = raw source
    name from `rawAllFields`); saving merges that one fieldKey into
    `mirrorFieldLabelsJson` and persists via `useUpdatePage` (then invalidates the
    pages query so `dynamic.tsx` re-supplies overrides). **Why moved here:** keeps
    editing next to where you see the result and stops the admin page modal from
    ballooning. `admin/pages.tsx` MirrorFieldPicker now only PICKS which fields
    show — it no longer reads/writes labels, so an admin "page save" must NOT send
    `mirrorFieldLabelsJson` (the PUT uses `if ("mirrorFieldLabelsJson" in body)`,
    so omitting it preserves inline-set labels).
  - **RBAC split:** label editing is gated by `canAdmin("pages")` (the page
    update endpoint requires the `pages` cap), independent of the entity-column
    setup gate `canConfigureColumns = canAdmin("entities")`. The setup-mode toggle
    on a mirror page is shown when EITHER cap is present; the per-header label
    button only when `canEditMirrorLabels` (isMirror && pageId && pages cap).
- All records routes and RBAC (record param, effective row scope, field access)
  key off the source entityId, so the mirror inherits them unchanged.

**Per-mirror-page record CRUD overrides:** a role's `permissionsJson.records` map
can carry, in addition to entity-keyed entries (`String(entityId)`), mirror-keyed
entries `mirror:<pageId>` (see `mirrorPermKey`). The override REPLACES the source
entity's CRUD rights, but ONLY for actions taken through that mirror page; absent
key = inherit the entity perm (backward compatible). Row scope (all/own) is never
per-page — it stays entity-level (`effectiveScope` ignores the override).
- **The override is resolved server-side by `effectiveRecordPerm(req,perms,entityId,pageId?)`,
  which is the real boundary.** It honors a `mirror:<pageId>` override only when
  BOTH hold: (1) the caller is authorized to that page (`perms.pageIds` includes
  pageId) AND (2) the page genuinely mirrors that entity (`pages.mirrorEntityId`
  === entityId, DB-checked + per-request cached). **Why:** the client sends `pageId`
  in record write/query bodies; without the page-access gate a caller could spoof a
  `pageId` to borrow a mirror override on a page they cannot use. Both checks must
  stay or the page-context permission becomes a broken-access-control vector.
- pageId rides in request BODIES (create/update/delete/query/filter-values), never
  as a query param on path-param GETs (that breaks Orval — see orval-param-collision).
  Consequently GET single/list of records stay entity-level by design; the page-aware
  read path is the POST `.../records/query` endpoint.
- Archive/unarchive (`setArchived`) intentionally stays entity-level: it is a global
  row-state change, not a "through the mirror page" edit. Fail-closed: a mirror-only
  update override does NOT grant archive.
- The client (`auth.tsx` canRecord/fieldAccess, `EntityRecords` permPageId =
  isMirror ? pageId : undefined) mirrors this cosmetically only; the server stays
  authoritative.
