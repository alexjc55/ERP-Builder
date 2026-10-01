/** Aggregate callers explicitly opt in; ordinary relation/lookup choices retain
 * their single-record projection restrictions. Formula source text stays private. */
export function relationOptionFields<T extends {
  fieldKey: string; fieldType: string; nameJson: unknown; formulaConfigJson?: unknown;
}>(fields: readonly T[], forAggregation = false) {
  return fields.filter(f => {
    const config = f.formulaConfigJson as { groupResult?: { enabled?: unknown } } | null;
    return f.fieldKey.trim() !== "" && (forAggregation || f.fieldType !== "function" || config?.groupResult?.enabled !== true);
  }).map(f => {
    const expression = (f.formulaConfigJson as { expression?: unknown } | null)?.expression;
    return {
      key: f.fieldKey, label: f.nameJson, fieldType: f.fieldType,
      ...(forAggregation ? { supportsSum: f.fieldType === "number" ||
        (f.fieldType === "function" && typeof expression === "string" && expression.trim().length > 0) } : {}),
    };
  });
}