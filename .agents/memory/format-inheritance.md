---
name: Field format inheritance
description: Shared entity/page field inheritance policy — response-only resolved rules, target visibility, and own-rule precedence.
---

A field whose value is COPIED by automations (e.g. заказ «Общий статус» filled from изделие statuses) can declare `formatInheritJson` sources: `{kind:"field",entityId,fieldKey}` (inherits that field's formatRulesJson), `{kind:"status",entityId}` (each active status → `equals` rules for every ru/en/he label, cellColor `${color}20`, textColor = color), or `{kind:"pageField",pageId,fieldKey}` (a mirror page's page-local field's rules — e.g. «Статус монтажа»).

**Rules:**
- Resolution happens server-side at READ time (`lib/format-inherit.ts`), attached as response-only `inheritedFormatRulesJson` on the entity-fields GET endpoints. NEVER merge inherited rules into `formatRulesJson` in responses — the field editor round-trips that column and would persist them.
- Client applies own rules first, then inherited (first match wins → own rules take precedence; no match anywhere = no formatting). Both EntityRecords eval points (row formatting + grouped-cell) must concat `[...formatRulesJson, ...inheritedFormatRulesJson]`.
- Bulk-resolve for a whole field list in TWO queries (fields + statuses), no per-field fan-out.
- No RBAC issue: only cosmetic source config (rules/colors) is exposed, no record values.
- **Why** status labels match by ANY language: automations copy one language's label string; matching all labels keeps it working regardless of which language was configured.

**Shared policy:** entity and page fields use the same inheritance semantics and editor. Own rules precede inherited rules; inheritance is explicit, not implied by a formula reference.
**Why:** a formula's data source and its desired presentation source are independent choices.
**How to apply:** keep resolved rules response-only for both field kinds, and use the same ordering in row and grouped-cell rendering.

**Visibility decision (user-confirmed, 2026-07-31, supersedes earlier gating):** inherited rules follow the TARGET field's visibility — anyone who sees the target field sees its inherited coloring, even from pages they can't open. Why: the matched values are copied into the target field anyway, so hiding colors leaks nothing extra and just renders inconsistently across roles. The earlier pageField page-access gating was deliberately reverted; do NOT re-add it as a "fix".

**Status-source rule style (user-confirmed):** status-derived inherited rules use SOLID status color fill + WCAG-contrast text (white/near-black), NOT the pale `${color}20` chip style — users read the pale version as "not colored".
