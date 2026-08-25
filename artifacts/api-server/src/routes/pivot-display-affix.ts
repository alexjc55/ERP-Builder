export interface PivotDisplayAffixField {
  fieldType: string;
  formulaConfigJson?: {
    displayAffix?: string | null;
    displayAffixPosition?: "before" | "after" | null;
  } | null;
}

export interface PivotMeasureDisplayAffix {
  /** Null identifies the sole measure in a single-measure pivot. */
  measureKey: string | null;
  displayAffix: string;
  displayAffixPosition: "before" | "after";
}

/**
 * Returns display-only metadata for a resolved sum measure. The supplied field
 * maps are already scoped by the caller, so this cannot expose hidden fields.
 */
export function resolvePivotMeasureDisplayAffix(
  measure: { agg: string; source?: string | null; fieldKey?: string | null },
  measureKey: string | null,
  entityFields: ReadonlyMap<string, PivotDisplayAffixField>,
  pageFields: ReadonlyMap<string, PivotDisplayAffixField>,
): PivotMeasureDisplayAffix | null {
  if (measure.agg !== "sum" || !measure.fieldKey) return null;
  const field =
    measure.source === "entity"
      ? entityFields.get(measure.fieldKey)
      : measure.source === "page"
        ? pageFields.get(measure.fieldKey)
        : undefined;
  if (!field || (field.fieldType !== "number" && field.fieldType !== "function")) return null;
  const affix = field.formulaConfigJson?.displayAffix?.trim() ?? "";
  if (!affix) return null;
  return {
    measureKey,
    displayAffix: affix,
    displayAffixPosition:
      field.formulaConfigJson?.displayAffixPosition === "before" ? "before" : "after",
  };
}