---
name: Linked formula sources
description: Security and consistency rules for formulas that aggregate page-local or cross-entity data.
---

Structured linked-formula source tokens are server-only capabilities. Never serialize their resolved scalar inputs to clients. Interactive responses may expose only the materialized result of a formula field that is visible to the viewer; hidden formula definitions must not participate in that viewer's evaluation scope.

**Why:** A raw aggregate token can reveal data configured behind a hidden formula, while stripping it without materializing the visible formula makes browser-rendered formulas silently fail. Page-qualified inputs also become an access-control bypass if a request-supplied page ID is trusted before canonical ownership and page-access checks.

**How to apply:** Resolve common source graphs and target-row permission scopes in batches, re-apply entity/page/field/row permissions at every hop, validate structured source references on write, evaluate authorized formula chains server-side, and return only normal visible formula-field keys. SYSTEM automation/dashboard contexts must remain explicit rather than inferred.