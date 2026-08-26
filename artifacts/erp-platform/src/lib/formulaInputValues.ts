/**
 * Values returned by the related-values endpoints have already passed the
 * server's field and row permission checks. Formula evaluation needs their
 * projected value, rather than the raw relation placeholder stored on a row.
 */
export type FormulaRelatedValue = {
  fieldKey: string;
  value?: unknown;
};

export type FormulaInputScope = {
  /** Entity whose persisted values are being evaluated. */
  entityId?: number;
  /** Page whose local values are being evaluated. */
  pageId?: number;
};

/**
 * Builds the input for formula evaluation from persisted entity values,
 * page-local values, and visible relation/lookup projections.
 *
 * Projections intentionally win over raw values. Relation fields can retain a
 * linked-record id (or another stale placeholder) in local state, but formulas
 * must use the permission-filtered value that is displayed in the table. The
 * values maps may also contain `source:*` keys injected by the server; they are
 * already permission-filtered scalar results and are deliberately retained as
 * opaque formula inputs.
 */
export function mergeFormulaInputValues(
  storedValues: Record<string, unknown> | null | undefined,
  pageValues: Record<string, unknown> | null | undefined,
  entityRelatedValues?: ReadonlyMap<string, FormulaRelatedValue>,
  pageRelatedValues?: ReadonlyMap<string, FormulaRelatedValue>,
  scope?: FormulaInputScope,
): Record<string, unknown> {
  const entityValues = storedValues ?? {};
  const currentPageValues = pageValues ?? {};
  const merged: Record<string, unknown> = {
    ...entityValues,
    ...currentPageValues,
  };

  for (const projection of entityRelatedValues?.values() ?? []) {
    merged[projection.fieldKey] = projection.value;
  }
  for (const projection of pageRelatedValues?.values() ?? []) {
    merged[projection.fieldKey] = projection.value;
  }

  // Keep legacy flat keys (where page values shadow entity values), while also
  // exposing the explicit aliases emitted by the formula editor. Build aliases
  // after relation projections so an alias can never reveal a raw linked id.
  if (scope?.entityId != null) {
    for (const [key, value] of Object.entries(entityValues)) {
      merged[`entity:${scope.entityId}.${key}`] = value;
    }
    for (const projection of entityRelatedValues?.values() ?? []) {
      merged[`entity:${scope.entityId}.${projection.fieldKey}`] = projection.value;
    }
  }
  if (scope?.pageId != null) {
    for (const [key, value] of Object.entries(currentPageValues)) {
      merged[`page:${scope.pageId}.${key}`] = value;
    }
    for (const projection of pageRelatedValues?.values() ?? []) {
      merged[`page:${scope.pageId}.${projection.fieldKey}`] = projection.value;
    }
  }

  return merged;
}