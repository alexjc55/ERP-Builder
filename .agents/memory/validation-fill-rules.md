---
name: Cross-field validation (fill) rules
description: Per-field validationRulesJson hard-boundary that blocks saving a record unless another field satisfies a condition; the invariant is that EVERY record write path must enforce it.
---

# Cross-field validation ("fill") rules

A per-entity-field JSONB `validationRulesJson` (distinct from cosmetic
`formatRulesJson` conditional formatting). Semantics: a value in THIS field
(any non-empty value, or only the chosen `applyToValues` for select fields) is
allowed only if the named `conditionFieldKey` satisfies an operator
(`empty|notEmpty|equals|notEquals|gt|lt|gte|lte|between`, with `value`/`value2`);
otherwise the save is rejected (HTTP 422) with an auto-generated Russian message.
Phase 1 = block + message only (no auto-fix). Page-local fields are intentionally
out of scope (separate value storage + validation path).

## The invariant that must stay consistent

**`checkValidationRules(fields, finalValues)` is a HARD server boundary and must
be re-applied on EVERY path that writes `entity_records.valuesJson`.** It is easy
to add a new write path that silently bypasses it.

**Why:** during review the first implementation only guarded the two obvious
endpoints (records create + update) and three other write paths bypassed the
boundary, letting violating state be saved.

**How to apply:** the currently-known write paths that each call it are:
- records create (after the dependent-values check)
- records update (only when `update.valuesJson !== undefined`, on the FINAL
  merged values — after workflow `set_field` and the immutability check — so a
  status transition cannot bypass it)
- automations engine `systemCreateRecord` and `systemUpdateRecord` (set_field)
- the dependent-value rename endpoint (`fields/:id/rename-value`) — pre-check
  every affected row's resulting values and reject the whole rename (no partial
  writes) if any would violate.
If you add another record-write path, call `checkValidationRules` there too.

## Other decisions

- Evaluated over the FINAL merged value map. `validateValues` drops empty fields
  from its cleaned map, so an absent key reads as empty — correct for the
  empty/notEmpty operators.
- Gating fires only when THIS field is non-empty; an empty field is never blocked.
- Ordered comparisons coerce via numeric first, then `Date.parse` epoch, so
  numeric and ISO-date fields both work; `equals`/`notEquals` use `String()`
  coercion (fine for select/user/boolean; numeric `1` vs `1.0` is an edge case).
- Stale rules referencing a removed condition field are ignored (no error).
- The server message is authoritative; the client editor preview mirrors its
  wording. The message always renders the field's actual saved value, so the
  config-time preview can only show a sample/placeholder.
- The condition-field picker excludes derived/link types (function/relation/
  lookup) because they hold no comparable scalar in `valuesJson`.
