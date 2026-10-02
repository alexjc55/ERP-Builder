---
name: Table data direction
description: Product semantics of optional text direction versus interface geometry and status translations.
---

**Rule:** Optional LTR/RTL settings apply across all UI languages with precedence field → page → ERP-wide → UI language. Clearing an override restores inheritance. This controls cell content, not table column order or the frozen-column edge.

**Why:** The user needs, for example, RTL data inside a Russian interface and per-page/per-field exceptions without changing the rest of the interface.

**Rule:** System status labels are excluded. Their direction follows the language of the displayed translation, including fallback: Hebrew is RTL, Russian/English are LTR. A Hebrew-only name remains RTL in Russian; a Russian-only name remains LTR in Hebrew.

**Why:** Interface language alone does not identify the language of a partially translated status. Text-only status projections lose provenance, particularly when translations start with digits or share identical text.

**How to apply:** Keep multilingual status metadata through projections. Apply data direction to content wrappers and portaled editors, not sticky td/th elements whose logical offsets depend on UI direction. Include effective direction in memoized row inputs.