/**
 * Normalize formulaConfigJson without dropping expression or other supported
 * properties. Formula decimals are rounded defensively because generated Zod
 * validates the range but does not enforce integer-ness. Display affixes belong
 * only to number/function fields; other field types have both affix keys removed
 * while preserving all unrelated (including legacy) config properties.
 */
export function normalizeFormulaFieldConfig<T>(config: T, fieldType: string): T {
  if (!config || typeof config !== "object") return config;

  const source = config as {
    decimals?: unknown;
    displayAffix?: unknown;
    displayAffixPosition?: unknown;
  };
  let normalized: Record<string, unknown> = { ...(config as object) };

  if ("decimals" in source && source.decimals != null) {
    const value = Number(source.decimals);
    normalized = {
      ...normalized,
      decimals: Number.isFinite(value) ? Math.min(10, Math.max(0, Math.round(value))) : null,
    };
  }

  if (fieldType !== "number" && fieldType !== "function") {
    delete normalized.displayAffix;
    delete normalized.displayAffixPosition;
  } else if ("displayAffix" in source || "displayAffixPosition" in source) {
    const displayAffix =
      typeof source.displayAffix === "string" ? source.displayAffix.trim() || null : null;
    normalized = {
      ...normalized,
      displayAffix,
      displayAffixPosition:
        displayAffix && source.displayAffixPosition === "before" ? "before" : displayAffix ? "after" : null,
    };
  }

  return normalized as T;
}