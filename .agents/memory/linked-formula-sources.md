---
name: Linked formula sources
description: Security and consistency rules for formulas that aggregate page-local or cross-entity data.
---

Structured linked-formula source tokens are server-only capabilities. Never serialize their resolved scalar inputs to clients. Interactive responses may expose only the materialized result of a formula field that is visible to the viewer; hidden formula definitions must not participate in that viewer's evaluation scope.

**Why:** A raw aggregate token can reveal data configured behind a hidden formula, while stripping it without materializing the visible formula makes browser-rendered formulas silently fail. Page-qualified inputs also become an access-control bypass if a request-supplied page ID is trusted before canonical ownership and page-access checks.

**How to apply:** Resolve common source graphs and target-row permission scopes in batches, re-apply entity/page/field/row permissions at every hop, validate structured source references on write, evaluate authorized formula chains server-side, and return only normal visible formula-field keys. SYSTEM automation/dashboard contexts must remain explicit rather than inferred.

**Client rendering invariant:** When a response contains a materialized value under a formula field's normal key, render and format that scalar directly. Never re-evaluate its expression in the browser: protected source tokens are intentionally absent and would turn a valid server result into empty.

## Qualified page references

**Explicit export exception:** a role-specific source-field export grant may bypass source page
membership only when used by an authorized destination formula. It never grants direct page API
access or exports sibling fields. Ordinary source field visibility and source mirror record,
own/filter scope, and hidden-status restrictions still apply even without page membership.
**Why:** operational pages need selected report values without opening the report; using ordinary
membership-dependent permission helpers would silently drop the inaccessible mirror's restrictions.
**How to apply:** evaluate exact source dependencies with export-aware source permissions. Propagate
denied projections separately from legitimate nulls through recursive formulas and aliases; omit
denied values from filter options and matches, including empty filters.

**Rule:** A formula token shaped like `{page:<id>.<field>}` must automatically enter the same permission-aware `pageLocal` resolution path as an explicitly configured page source; parsing the token without loading its source is not valid support.

**Why:** The editor's qualified syntax promises an unambiguous cross-page value, but a token without a separately persisted source used to evaluate as empty even when that same record had a value on the referenced page.

**How to apply:** Infer only positive page IDs and non-empty keys, then let canonical page ownership, active-field, page-access, field-access, and row-scope checks fail closed. Never copy raw cross-page values into client responses.

## Computed projection targets

**Rule:** A page-local formula may be projected only through the shared read-time formula runtime. Keep native entity and page inputs in separately permission-filtered scopes; a same-key page field must never re-admit a hidden entity value. Evaluate recursion with a per-formula ancestor path, not one batch-wide visited set. Group-result formulas are not projection targets until the caller can compute winners over the full authorized set.

**Why:** Formula results are not stored, batch-wide cycle tracking rejects valid sibling dependency graphs, merged native scopes can leak hidden same-key values, and evaluating a grouped formula over a linked subset produces a plausible but incorrect result.

**How to apply:** Materialize visible scalar formulas transiently with qualified scopes, calendar options, linked inputs, bounded recursion, and page-aware row filtering. Reject computed aggregate/equality operands and grouped projection targets at save time and re-check at read time until those paths have equivalent full-set semantics.

## Legacy flat relation/lookup references

**Rule:** A legacy flat formula reference to a relation/lookup field must be derived from the active field schema and resolved through the same permission-aware linked-source path as a structured source. Keep formula scope inputs separate from response values: current-page projections may shadow flat keys, but must not overwrite or remove a same-key entity scalar or leak a transient source token.

**Why:** Relation/lookup values are not stored in the record JSON. Treating a flat reference as an ordinary stored key makes the formula silently empty; flattening the projected value into response data can also erase a legitimate same-key entity value. Re-resolving a full target set once per base-row chunk multiplies target scans.

**How to apply:** Discover only referenced active relation/lookup fields, fail neutral on stale/invalid metadata, authorize every base/target resource and row, resolve the complete evaluation set once, and partition projected page inputs from entity inputs before building qualified scopes. SuperAdmin bypasses redundant grant rows but not schema existence.

## Equality through a shared relation

**Rule:** Two relation fields may be used as an equality join only when both point to the same intermediate entity. Match by the intersection of permission-approved linked record IDs, never by relation IDs, labels, or display text.

**Why:** Records from different entities can belong to the same order without being linked directly to each other. Matching displayed order numbers is unstable and can bypass the linked order's row boundary. The intermediate record may already be loaded for another formula source; loaded presence is not proof of authorization for this join.

**How to apply:** Validate both relation endpoints on write; collect intermediate IDs from each relation field's owner side regardless of whether those records are already in the shared loaded graph, then authorize/filter every intermediate row before constructing join keys. Preserve scalar equality behavior, stable target-record ordering, and fail neutral when metadata or access is missing.