/**
 * Values returned by the related-values endpoints have already passed the
 * server's field and row permission checks. Formula evaluation needs their
 * projected value, rather than the raw relation placeholder stored on a row.
 */
export type FormulaRelatedValue = {
  fieldKey: string;
  value?: unknown;
};

/**
 * Builds the input for formula evaluation from persisted entity values,
 * page-local values, and visible relation/lookup projections.
 *
 * Projections intentionally win over raw values. Relation fields can retain a
 * linked-record id (or another stale placeholder) in local state, but formulas
 * must use the permission-filtered value that is displayed in the table.
 */
export function mergeFormulaInputValues(
  storedValues: Record<string, unknown> | null | undefined,
  pageValues: Record<string, unknown> | null | undefined,
  entityRelatedValues?: ReadonlyMap<string, FormulaRelatedValue>,
  pageRelatedValues?: ReadonlyMap<string, FormulaRelatedValue>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(storedValues ?? {}),
    ...(pageValues ?? {}),
  };

  for (const projection of entityRelatedValues?.values() ?? []) {
    merged[projection.fieldKey] = projection.value;
  }
  for (const projection of pageRelatedValues?.values() ?? []) {
    merged[projection.fieldKey] = projection.value;
  }

  return merged;
}