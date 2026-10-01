/** Formula results are dynamic; the API checks actual numeric values at read time. */
export function isWidgetSumField(field: {
  fieldType: string; isActive?: boolean; formulaConfigJson?: unknown;
}): boolean {
  if (field.isActive === false) return false;
  if (field.fieldType === "number") return true;
  const expression = (field.formulaConfigJson as { expression?: unknown } | null)?.expression;
  return field.fieldType === "function" && typeof expression === "string" && expression.trim().length > 0;
}