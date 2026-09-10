type FormulaField = {
  fieldKey: string;
  fieldType: string;
  formulaConfigJson?: unknown;
};

/**
 * Infer a formula result type only when its entire expression is a direct
 * reference to a visible entity field.  Flat references are legacy aliases,
 * but are safe only when no page field can shadow the entity key.
 */
export function directEntityFormulaResultType(options: {
  formula: FormulaField;
  entityId: number;
  entityFields: readonly FormulaField[];
  pageFields: readonly FormulaField[];
}): string | null {
  const expression = (options.formula.formulaConfigJson as { expression?: unknown } | null)?.expression;
  if (typeof expression !== "string") return null;
  const match = /^\s*\{\s*([^{}]+?)\s*\}\s*$/.exec(expression);
  if (!match) return null;

  const token = match[1]!;
  const qualified = /^entity:(\d+)\.(.+)$/.exec(token);
  let fieldKey: string;
  if (qualified) {
    if (Number(qualified[1]) !== options.entityId) return null;
    fieldKey = qualified[2]!;
  } else {
    if (token.includes(":") || token.includes(".")) return null;
    fieldKey = token;
    if (options.pageFields.some((field) => field.fieldKey === fieldKey)) return null;
  }
  return options.entityFields.find((field) => field.fieldKey === fieldKey)?.fieldType ?? null;
}