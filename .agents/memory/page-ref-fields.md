---
name: page_ref page fields
description: page-field type that read-only displays another mirror page's page-local field for the same record
---
A `page_ref` page field on mirror page B displays (READ-ONLY) the value of a page-local field from another page A with the SAME effective entity — same record, no relation/link involved (lookup can't do this: no link exists between two mirrors of one entity).

Rules that must stay consistent:
- Config = {sourcePageId, sourceFieldKey} in page_fields.pageRefConfigJson; `resolved*` metadata (source type/options/percent) is RESPONSE-ONLY enrichment in GET /pages/:id/fields — never stored.
- Values are merged server-side into GET /pages/:id/record-values under the page_ref key (client renders from pageValues as usual). Writes to page_ref keys are silently dropped (like function/relation/lookup) — source of truth stays on page A.
- Read boundary (BOTH fields metadata and value merge, independently): viewer boundary of the base query (entity view + own scope + hidden row statuses) AND source-page access (perms.pageIds) AND the source FIELD's own per-role visibility AND the page_ref column's own visibility. superAdmin/pages-admin bypass the page/field gates for setup.
- Source eligibility (active + value-backed type from PAGE_REF_SOURCE_TYPES, in lockstep client PageFieldConfigDialog ↔ server page-fields.ts) is re-validated AT READ TIME — stale refs resolve to nothing, never to raw JSON.
- Integrity (user-approved cascade): deleting the source field or source page cascade-deletes referencing page_ref fields; renaming the source key REWRITES referencing configs; retyping to an ineligible type cascade-deletes.
- page_ref is page-field-only; entity fields routes reject the type. v1 has no filters/sort/totals on page_ref.

**Why:** the "show page A's field on page B" ask is natural for mirror pages; hanging it on relations would require fake self-links. The double independent permission check exists because record-values must stay authoritative even when the client skips the fields call.
