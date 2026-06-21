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
  - **The rename dialog's "source name" hint must follow the active language
    tab, not the UI locale.** The hint that shows the source field's original
    name must reflect whichever RU/EN/HE tab the admin has open in
    `MultilingualInput`, and disappear entirely when that language has no source
    name. **Why:** it previously pre-resolved via `ml(nameJson)` (UI locale) and
    never changed with the tab. **How to apply:** pass the full `nameJson` object
    (not a pre-resolved string) and lift the input's active tab up via
    `MultilingualInput`'s optional `onActiveLangChange` callback — that component
    keeps its active-tab state internal, so any per-language sibling UI (hints,
    counters) must subscribe through this callback rather than guessing the lang.
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
key = inherit the entity perm (backward compatible). Row scope (all/own +
`scopeFieldKeys`) is ALSO per-page: a `mirror:<pageId>` override carries its own
scope, and when an authorized override exists the row scope is taken ENTIRELY from
it (missing scope ⇒ "all"), fully REPLACING the entity scope — it does not merge.
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
- **The CRUD GATE's page-awareness must track the handler's, not just the scope.**
  `requireRecordParam` reads `pageIdFromBody`, and Express parses a JSON body even on
  GET — so the entity-direct `GET .../records` (entity-level scope + entity-level
  field-hidden) MUST gate with `requireRecordParam("view", { entityOnly: true })`.
  Without it a mirror-only role (no entity view, only `mirror:<pageId>` view) passes
  the page-aware gate with a spoofed body `pageId`, then gets served entity-level
  scope/fields — a confused-deputy widening. **Rule:** gate page-awareness, row-scope
  page-awareness, AND field-hidden page-awareness must all agree per route (all
  entity-level, or all carry the same pageId).
- **Row scope resolver = `effectiveScopeFor(req,perms,entityId,pageId?)`** (async,
  parallels `effectiveRecordPerm`'s page gating). EVERY base-entity page-context
  row-scope site must call it with the pageId — page-fields `record-values`,
  `records/:id/values` update, `related-values` base, `related-link` base — NOT the
  sync entity-level `effectiveScope`. **Why:** page-aware CRUD (`assertRecord(...,pageId)`)
  without page-aware row scope is fail-open: `entity=all` + `mirror override=own`
  would still return all rows. The two must move together at every page route.
  The RELATED-entity scope on those same endpoints (relScope for `relatedEntityId`)
  and the entity-context `/entities/:entityId/related-link` correctly STAY
  `effectiveScope` — no mirror page applies to them.
- **EVERY read surface EntityRecords uses on a mirror page must be page-aware**, not
  just the base records query. A role can have access to the mirror's entity ONLY via
  the `mirror:<pageId>` override (entity-level view off). The entity-keyed
  `POST /entities/:entityId/related-values` (relation+lookup ENTITY columns) was a
  silent miss: it gated entity-level, so a mirror-only role saw every related/lookup
  column as a dash even after granting view on the related entities. Fix = accept an
  optional `pageId` in the body and pass it to `assertRecord`/`effectiveScopeFor`; the
  client threads `permPageId` (isMirror?pageId:undefined). **Why:** base record query
  being page-aware while a sibling read endpoint is not is the recurring failure mode —
  audit ALL of EntityRecords' fetches for the page context, not just the obvious one.
  Related-ENTITY checks on that endpoint correctly stay entity-level (no mirror page
  applies to the related entity).
- Archive/unarchive (`setArchived`) intentionally stays entity-level: it is a global
  row-state change, not a "through the mirror page" edit. Fail-closed: a mirror-only
  update override does NOT grant archive.
- The client (`auth.tsx` canRecord/fieldAccess, `EntityRecords` permPageId =
  isMirror ? pageId : undefined) mirrors this cosmetically only; the server stays
  authoritative.

**Per-mirror-page UNIFIED column order (`mirrorColumnOrderJson`):** a mirror page
can reorder its source-entity columns AND its page-local columns into one
interleaved order, independent of the source entity's field `sortOrder`. Stored as
`pages.mirrorColumnOrderJson` = ordered tokens `e:<fieldKey>` (entity) / `p:<fieldKey>`
(page-local). DISPLAY-ONLY, never a security boundary.
- **How to apply / invariants:**
  - Empty/absent ⇒ the historical default order (entity columns by sortOrder, then
    page-local columns). Tokens not present fall back to the end in default order
    (stable) — so adding a field later never breaks an existing saved order.
  - Active ONLY when `isMirror`. Non-mirror pages keep the two-group render (entity
    then page) and the per-group `sortOrder` reorders (`reorderFields` /
    `reorderPageFields`); the prop is only threaded on mirror pages.
  - `EntityRecords` builds ONE `orderedColumns: UnifiedCol[]` (kind entity|page,
    each carrying its `pinKey` `f:<id>`/`pf:<id>`) and EVERY column render site
    iterates it: totals row, header row, inline add-row cells, record-row cells,
    colSpans, and the pinned (frozen-left) calc. **Why:** the source-entity and
    page-local columns used to be two separate `.map`s at ~6 sites; interleaving
    requires a single ordered pass or the header/body columns desync.
  - Reorder on a mirror page = move within `orderedColumns` and persist the new
    token list via `useUpdatePage` (the page update endpoint requires the `pages`
    cap server-side; gated client-side by `canReorderMirrorColumns = isMirror &&
    pageId && canAdmin("pages")`), then invalidate the pages query.
  - Server: add to the page UPDATE allowlist (`if ("mirrorColumnOrderJson" in body)`);
    CREATE flows through the generated Zod automatically. (Same dual create+PUT rule
    as any field-config JSONB.)
  - **Setup-mode-ONLY page-header tint:** on a mirror page in setup mode, page-local
    column headers get a distinct background (violet) so the admin can tell them
    apart from entity columns. Normal view stays byte-for-byte identical — this does
    NOT violate the page-local "look identical in normal view" invariant because it
    is gated on `setupMode && isMirror && isPageCol`.
