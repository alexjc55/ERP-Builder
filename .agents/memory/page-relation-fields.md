---
name: Page related fields (related columns / related metrics)
description: Surfacing a single linked record's field on pages, in dashboard metrics, and in table widgets — the aggregation and boundary rules that must stay consistent.
---

# Page related fields

Page-fields of type `relation` (config `{relationId, relatedFieldKey}` in `relationConfigJson`) surface ONE field of a single linked record. Only single-link directions qualify: source side ∈ {one_to_one, many_to_one}, target side ∈ {one_to_one, one_to_many} — i.e. each base record links to at most one related record.

## Related metric aggregation is PER LINK, not per unique linked record
**Rule:** a related metric is computed over the filtered BASE records. For each base record that has a link, walk to its single linked record. `count` = number of links (`map.size`, base→linked map). `sum` = the related numeric field summed once per *linking base record*.

**Why:** under many_to_one / one_to_many several base records can point to the SAME linked record. Deduping linked ids (`new Set(map.values())`) undercounts and under-sums — a real correctness bug caught in review. The metric question is "over my filtered base rows, count/sum their linked value", so each link must contribute even when it points at a shared related record.

**How to apply:** in `dashboard.ts` `computeMetric` related branch, fetch the related field value into a `Map<linkedId, value>` over the *unique* linked ids (one query), then accumulate by iterating `map.values()` (the per-base-record linked ids, with duplicates). Never return `Set(map.values()).length`.

## Count metric must NOT resolve a related field
**Rule:** for a related metric, `count` sends `fieldKey: null` by design (it counts links, no field needed). The compute path must resolve only the relation *direction* (via `relationDirection`) for count; calling `resolveRelationField(..., fieldKey ?? "")` errors (field "" not found) → silently returns 0. Only `sum` resolves the related field. Validation already allows count-without-field; the bug was compute-side.

## Per-page role visibility is a SERVER boundary, not a client filter
**Rule:** `GET /pages/:pageId/fields` must drop page-fields whose `permissionsJson[roleId] === "hidden"` for non-admin viewers — the column metadata/label/config must never reach a hidden role, not just its values. Admins who can edit pages (superAdmin || admin.pages) still receive every field so column setup mode can configure hidden columns.

**Why:** the frontend derives displayed columns straight from this endpoint; filtering only on the client leaks restricted column existence/labels/config. The related-values endpoint already filters values by role, but metadata must be gated at its own source.

## relation-options is DUAL-USE (entities OR pages cap), gate by the union
**Rule:** the entity-keyed `GET /entities/:entityId/relation-options` backs BOTH the dashboard widget editors (metric related fields, table related columns — `pages` cap) AND the entity Fields Builder configuring a `relation` field (`entities` cap). It cannot use `requireAdmin("pages")` alone: use an inline guard allowing `superAdmin || admin.entities || admin.pages`. The page-keyed `/pages/:pageId/relation-options` variant stays `pages`-only.

**Why:** when the endpoint became dual-use (entity relation fields were added on top of the dashboard use), `requireAdmin("pages")` locked entities-only roles out of configuring relation fields. `requireAdmin` takes a single cap, so a shared config-helper consumed by two differently-capped screens needs an explicit union guard.

## Table widget needs ≥1 column across direct OR related
`validateTableConfig` must accept a config where `fieldKeys` is empty as long as `relatedColumns` has at least one entry (related-only tables are valid). Requiring non-empty `fieldKeys` breaks the related-only UX the frontend allows.

## `relation` is now valid on BOTH entity-fields and page-fields
The `relation` value lives in the shared `FieldType` OpenAPI enum, and is now a real entity-field type too (config `{relationId, relatedFieldKey}` in entity_fields.relationConfigJson). Eligible (task contract) ONLY when the entity is the SOURCE side of a to-one relation (`one_to_one`/`many_to_one`); target-side, 1:N and N:N are out of scope (page relation fields are broader — they also allow the target side — but entity relation fields are intentionally narrower). `fields.ts` has its own `relationDirection` (source-only) separate from the broader `page-fields.ts` copy. The shared `buildRelationOptions` now returns a `direction` per option so the entity Fields Builder can filter to `source` (and hide the `relation` type when none qualify) without narrowing the shared endpoint used by dashboards/pages. It is DERIVED: never stored in valuesJson (records.ts `validateValues` skips it like `function`); the link lives in `record_links` and is assigned via `PUT /entities/:entityId/related-link`. fields.ts create/PUT validate via `validateEntityRelationConfig`, persist `relationConfigJson` (`?? {}`), reset to `{}` when switching away, and exclude relation from isKey ONLY (`isKey` needs a stored scalar for uniqueness; relation has none). **Why (historical):** it was previously page-field-only and entity-field create/PUT hard-rejected it; that rejection has been removed. The entity records table shows the linked value via a click-to-assign searchable picker (`EntityRelationLinkPicker`), the entity twin of the page `RelationLinkPicker`.

## TWO entity-field editors must stay in parity
**Rule:** entity fields can be created/edited from BOTH the dedicated Fields Builder (`entity-fields.tsx`) AND the inline `FieldConfigDialog.tsx` (opened from a page's setup mode in `EntityRecords.tsx`; both write via `useCreateEntityField`/`useUpdateField`). Any new entity-field type or per-type config (e.g. `relation`) must be added to BOTH or the inline surface silently lacks it.

**Why:** a user hit this — `relation` existed in the Fields Builder but not in page setup mode because `FieldConfigDialog` is a separate component with its OWN `FIELD_TYPES` const. Easy to add all the relation plumbing (state/derivations/payload/UI) yet forget the actual `{ value: "relation" }` entry in `FIELD_TYPES`, so the filtered picker shows nothing — caught in code review.

**How to apply:** when porting a type to `FieldConfigDialog`, mirror `entity-fields.tsx`: add the `FIELD_TYPES` entry, the source-only relation gating (`direction==="source"`, `canUseRelation`, keep visible while editing existing), `relationConfigJson` in payload, `relationIncomplete` on `canSubmit`, exclude `isKey` for relation, keep `lockAfterCreate`, hide default-value. `PageFieldConfigDialog.tsx` is a THIRD picker but writes PAGE fields (broader relation scope) — do not narrow it to source-only.

## lockAfterCreate IS allowed + enforced for entity relation fields (isKey is not)
**Rule:** a relation entity-field MAY set `lockAfterCreate`. The relation value is derived (never in valuesJson), so `checkImmutableFields` in records.ts never sees it — the lock is enforced wherever the underlying `record_links` row is mutated. The lock is a property of the **link contour, not a single field**: it applies to a `(relationId, side)` when ANY relation entity-field on that side has `lockAfterCreate`. Helper `lib/relationLock.ts` `getRelationLockSides(tx, relationId)` → `{sourceLocked,targetLocked}` (matches `relationConfigJson ->> 'relationId'`, maps `entityId` to source/target side) + `linkExistsForSide(...)`. Enforced in TWO mutation paths: ENTITY `PUT /entities/:entityId/related-link` (throw `RELATION_LOCKED` inside the relation-row-locked tx when the side is locked AND a link already exists → 409 «Поле «<ruName>» нельзя изменить после создания записи») and the manual relations engine `DELETE /links/:id` (409 when either side is locked). FIRST assignment (no existing link) is always allowed; any later change OR clear is blocked. No superAdmin exception (mirrors checkImmutableFields semantics).

**Why:** the toggle had been excluded as cosmetic precisely because the relation value bypasses the records UPDATE path. Checking only the *requested* field, or only the related-link endpoint, left two bypasses (a second UNLOCKED relation field over the same relation; the manual `DELETE /links/:id`) — both caught in code review. Hence the side-level + multi-path enforcement.

**How to apply:** `POST /records/:recordId/links` needs NO guard — relation fields are only eligible on single-link sides, so a second insert on a locked base side already 409s on `record_link_source_one/target_one`, and change-via-POST is impossible without a (now-blocked) DELETE first. `DELETE /relations/:id` is intentionally NOT guarded (admin structural/DDL-like delete of the whole relation, not a field-value mutation). The page related-link twin is NOT changed because `page_fields` has no `lockAfterCreate` column (the two endpoints are otherwise byte-identical). UI: `entity-fields.tsx` shows the lockAfterCreate toggle for relation (keeps isKey hidden) + a hint; `EntityRecords.tsx` makes a locked relation cell read-only once `linkedRecordId != null` to mirror the server boundary (UX only — the 409 is the hard guard).

## Widgets are admin-authoritative but visibility-gated
Metric/chart/table widget values are computed bypassing the viewer's row/field perms (real totals), but only after page access + per-widget role visibility pass. Related columns/metrics inherit this — do not re-filter widget values by viewer perms.

## related-values must re-apply the related entity's RECORD-VIEW boundary first
**Rule:** before exposing any related column metadata/value, check `canRecord(perms, relatedEntityId, "view")`. If the viewer cannot view the related entity at all, force `access = "hidden"` (no type, no value, no linkedRecordId).

**Why:** `resolveFieldAccess` defaults to `"view"` when no explicit field perm exists, so relying on it alone leaks values from an entity the viewer has zero record-view permission on. Field/own-scope checks are NOT a substitute for the entity-level view gate.

**How to apply:** this gate is only for VIEWER-scoped reads (the records-table related-values endpoint). Dashboard widget compute paths are admin-authoritative by design (bypass viewer perms, gated by per-widget role visibility) and must NOT add this check.

## related-values endpoint must not leak restricted linked-record ids
`POST /pages/:pageId/related-values` re-applies the related-entity field access + related own-scope + per-page role visibility. **Only expose `linkedRecordId` when the linked row is actually visible** to the viewer. Returning the id while nulling `value` leaks existence/identity of restricted related rows (IDOR-adjacent). The id is only needed for cells the viewer can read (and, when editable, write back through), so gate it on the same `visible` flag as `value`.

## relation columns ASSIGN the link, they do not edit the related value
**Rule:** clicking a relation page-field cell opens a searchable picker that creates/changes/clears the single `record_links` row for the base record (endpoints `POST /pages/:pageId/related-candidates` + `PUT /pages/:pageId/related-link`). The column DISPLAYS the linked record's `relatedFieldKey` value read-only; it never writes back to the linked record's field. `editableColumn`/per-cell `editable` in related-values now means "assignable" and is column-wide (true even with NO link) so EMPTY cells are clickable to assign.

**Why:** users expect a relation column to pick *which* record is linked, not to edit a foreign record's data through it. The old write-back behavior also made empty cells inert (could only edit an already-linked record).

**How to apply:** assignability = `pagePerm === "edit" && relatedAccess !== "hidden" && canRecord(perms, baseEntityId, "update")`. The link mutation is a transactional relation-row-lock → delete existing single-link for `(relation, baseRecord, direction)` → insert (or just delete when clearing). Direction maps base↔linked onto source/target columns; cardinality unique-violation (`record_link_source_one/target_one/unique`) → 409. Use POST/PUT bodies (never GET+query) to avoid the Orval param-collision gotcha.

## candidates + link endpoints must re-apply the related-field HIDDEN boundary, not just record-view + own-scope
**Rule:** both `related-candidates` (label/search expose the field value) and `related-link` (mutation) must reject with 403 when `resolveFieldAccess(relatedField, perms, roleId, relatedEntityId) === "hidden"` — in addition to the entity record-view + own-scope checks. The UI hides the column via `editableColumn` (which already depends on non-hidden access), but a direct API call bypasses the UI.

**Why:** a role with related-entity view but a HIDDEN specific related field could otherwise enumerate/search that field's values through candidates, or assign links it shouldn't, via direct API. Caught in code review. Mirror the same dual boundary (record-view gate + per-field hidden gate) that related-values applies to its column.

## related-link must ALSO re-apply the row-hidden-STATUS boundary on the linked record
**Rule:** `related-candidates` filters out status-hidden related records (`hiddenRowStatusWhere(effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds)`), so `related-link` (both page and entity variants) MUST add the SAME condition to its linked-record lookup query. Otherwise a direct PUT with a known id can link to — and read the returned `value` of — a record the viewer can't see by status. The own-scope check alone does NOT cover status-hidden rows.

**Why:** caught in code review; candidates and link enumerate/expose the same related value, so every boundary candidates applies (record-view, per-field hidden, own-scope, AND row-hidden-status) must be mirrored on link. Add the hidden-status WHERE to the `linked` SELECT so a hidden row resolves to "not found" (400) instead of leaking.

## Dependent (cascading) relation fields + create-in-place
**Rule:** an entity `relation` field can be DEPENDENT — `dependencyConfigJson.{dependsOnFieldKey, relatedFilterFieldKey}` narrows its candidate records to those whose `relatedFilterFieldKey` (a field IN the related entity) matches the base row's parent value. The picker is gated (disabled) until the parent has a value; a previously-set ("stale") link stays clearable because relation children are NOT auto-cleared when the parent changes. The base-record link mutation re-checks the dependency match server-side (clearing always allowed) — client gating is cosmetic. The picker also offers "+ create related record" which creates a record in the related entity then links it; the dependency filter field is prefilled+locked to the parent value.

**Why:** the parent value can be a scalar OR a relation (then it's the linked record id as a string). The same `parentValue` string must be computed identically on client (cell wiring) and server (candidate filter): relation parent → linked record id; scalar parent → stored value. The create-in-place flow is NOT atomic — create + (optional) set-dependency-link + link-to-base are separate calls; a failure after create leaves an orphan, so report "created but not linked" honestly rather than "create failed".

**How to apply:** the entity-keyed `related-candidates` response carries `relatedEntityId` + `canCreate` (`canRecord(perms, relatedEntityId, "create")`) so the picker can offer create; the page-keyed variant omits them (no create from page pickers). `canCreate` is cosmetic — real authz is the related entity's own `POST /records` + `related-link` server boundaries. Quick-create form offers only valuesJson-backed types (relation/function excluded); a scalar dependency filter field goes in via valuesJson (locked input), a relation dependency filter field is set via a post-create `related-link` call. Guard `Number(lockedValue)` against NaN.

## `lookup` (поле подстановки) = read-only PROJECTION reusing the relation contour
**Rule:** `lookup` is a separate entity `FieldType` that REUSES `relationConfigJson {relationId, relatedFieldKey}` (NO new config key) to project a linked record's field value READ-ONLY. It is resolved by the SAME entity `related-values` route as `relation` (`inArray(fieldType,["relation","lookup"])`), but is never assignable: it forces `editableColumn=false`, and the write paths (`related-candidates`/`related-link`) reject it automatically because `resolveRelationEntityField` filters `fieldType="relation"` only. `fields.ts` validates its config exactly like `relation` (create+PUT, reset to `{}` when switching away from relation OR lookup) but EXCLUDES it from both `isKey` AND `lockAfterCreate` (it has no stored value and no link to assign — unlike `relation` which keeps lockAfterCreate). `records.ts validateValues` skips it like `function`/`relation` (never in valuesJson). Stage 4 write-through is intentionally out of scope.

**Why:** lookup differs from relation by being a pure derived display of an ALREADY-linked record's field — no picker, no link assignment. Collapsing it onto the relation config avoids a parallel config surface, but every relation branch must be audited: include lookup where read/display happens (related-values, table cell, FieldConfigDialog relation UI, EntityRecords relation key memos) and EXCLUDE it everywhere a value is written or a link assigned.

**How to apply (read-only must hold EVERYWHERE, not just the table):** the table cell + add-row were the obvious surfaces, but the RECORD MODAL was the silent miss — `FieldInput` has no `lookup`/`relation` case so they fall to the default editable `<Input>`. Two central guards fix the whole contract: (1) `formToValues` skips `function|relation|lookup` so derived fields can never enter the PUT/POST payload (server drops them too, defence in depth); (2) the modal computes `readOnly = access==="view" || fieldType==="lookup"`. When adding any future derived field type, add it to BOTH guards, not just the table render branch. FieldConfigDialog: lookup shares the relation config UI (relation + related field) but the dependency sub-UI stays relation-only, and isKey/lockAfterCreate/defaultValue are hidden for lookup.

## Resizable records-table columns (viewer-local, auto-layout clamp)
**Rule:** column widths in the records table are a per-viewer localStorage preference (key `erp:colwidths:{entityId}:{pageId}`), NOT a server contract. To make the `table-layout: auto` table actually honour a width, EVERY cell in that column (totals header, main header, add-row, and all body td variants — entity + page incl. relation/boolean/function/inline-editor) must carry `width+minWidth+maxWidth` of the same value; otherwise the widest unconstrained cell wins and the width is ignored.

**Why:** applying the width only to the header (or via a single `<col>`) does not constrain auto-layout — content-driven cells override it, and per-cell `max-w-[240px]` keeps truncating even in a wider column.

**How to apply:** column keys are `f:{id}` / `pf:{id}` / `__status__`. A window-level pointer drag from a header-edge handle updates width live and persists on pointerup; an in-flight drag MUST be torn down on unmount and on window `blur` (ref-held idempotent cleanup that also restores `document.body` cursor/userSelect), or listeners/body styles leak across navigation. Double-click the handle deletes the stored width (reset to natural).
