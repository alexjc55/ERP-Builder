---
name: Linked formula sources
description: Security and consistency rules for formulas that aggregate page-local or cross-entity data.
---

Structured linked-formula source tokens are server-only capabilities. Never serialize their resolved scalar inputs to clients. Interactive responses may expose only the materialized result of a formula field that is visible to the viewer; hidden formula definitions must not participate in that viewer's evaluation scope.

**Why:** A raw aggregate token can reveal data configured behind a hidden formula, while stripping it without materializing the visible formula makes browser-rendered formulas silently fail. Page-qualified inputs also become an access-control bypass if a request-supplied page ID is trusted before canonical ownership and page-access checks.

**How to apply:** Resolve common source graphs and target-row permission scopes in batches, re-apply entity/page/field/row permissions at every hop, validate structured source references on write, evaluate authorized formula chains server-side, and return only normal visible formula-field keys. SYSTEM automation/dashboard contexts must remain explicit rather than inferred.

## Legacy flat relation/lookup references

**Rule:** A legacy flat formula reference to a relation/lookup field must be derived from the active field schema and resolved through the same permission-aware linked-source path as a structured source. Keep formula scope inputs separate from response values: current-page projections may shadow flat keys, but must not overwrite or remove a same-key entity scalar or leak a transient source token.

**Why:** Relation/lookup values are not stored in the record JSON. Treating a flat reference as an ordinary stored key makes the formula silently empty; flattening the projected value into response data can also erase a legitimate same-key entity value. Re-resolving a full target set once per base-row chunk multiplies target scans.

**How to apply:** Discover only referenced active relation/lookup fields, fail neutral on stale/invalid metadata, authorize every base/target resource and row, resolve the complete evaluation set once, and partition projected page inputs from entity inputs before building qualified scopes. SuperAdmin bypasses redundant grant rows but not schema existence.