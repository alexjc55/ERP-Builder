---
name: Field format inheritance
description: entity_fields.formatInheritJson — a field inherits conditional formatting from other entities' fields/statuses; resolved server-side into response-only inheritedFormatRulesJson.
---

A field whose value is COPIED by automations (e.g. заказ «Общий статус» filled from изделие statuses) can declare `formatInheritJson` sources: `{kind:"field",entityId,fieldKey}` (inherits that field's formatRulesJson), `{kind:"status",entityId}` (each active status → `equals` rules for every ru/en/he label, cellColor `${color}20`, textColor = color), or `{kind:"pageField",pageId,fieldKey}` (a mirror page's page-local field's rules — e.g. «Статус монтажа»).

**Rules:**
- Resolution happens server-side at READ time (`lib/format-inherit.ts`), attached as response-only `inheritedFormatRulesJson` on the entity-fields GET endpoints. NEVER merge inherited rules into `formatRulesJson` in responses — the field editor round-trips that column and would persist them.
- Client applies own rules first, then inherited (first match wins → own rules take precedence; no match anywhere = no formatting). Both EntityRecords eval points (row formatting + grouped-cell) must concat `[...formatRulesJson, ...inheritedFormatRulesJson]`.
- Bulk-resolve for a whole field list in TWO queries (fields + statuses), no per-field fan-out.
- No RBAC issue: only cosmetic source config (rules/colors) is exposed, no record values.
- **Why** status labels match by ANY language: automations copy one language's label string; matching all labels keeps it working regardless of which language was configured.

**Limits:** page fields themselves cannot inherit (only entity fields carry formatInheritJson); source picker offers pages only when they are mirror pages (page-local fields exist only there).

**Visibility decision (user-confirmed, 2026-07-31, supersedes earlier gating):** inherited rules follow the TARGET field's visibility — anyone who sees the target field sees its inherited coloring, even from pages they can't open. Why: the matched values are copied into the target field anyway, so hiding colors leaks nothing extra and just renders inconsistently across roles. The earlier pageField page-access gating was deliberately reverted; do NOT re-add it as a "fix".
