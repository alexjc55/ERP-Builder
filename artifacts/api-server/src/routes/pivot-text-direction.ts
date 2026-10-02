type Direction = "ltr" | "rtl";
type SourceField = { fieldKey: string; textDirection?: Direction | null };
type Dimension = { source: string; fieldKey?: string | null };
type Measure = { agg: string; key?: string | null; source?: string | null; fieldKey?: string | null };

export interface PivotTextDirections {
  row?: Direction | null;
  column?: Direction | null;
  rowLanguageDriven: boolean;
  columnLanguageDriven: boolean;
  columnIsMeasure: boolean;
  measures: { measureKey: string | null; textDirection: Direction | null }[];
}

/**
 * Display-only source overrides, derived from the caller's existing field set.
 * Call only after pivot validation succeeds. No source IDs, config, values or
 * hidden field metadata are added to the response.
 */
export function resolvePivotTextDirections(
  pivot: { rows: Dimension; cols?: Dimension | null; measure?: Measure | null; measures?: Measure[] | null },
  entityFields: readonly SourceField[],
  pageFields: readonly SourceField[] = [],
): PivotTextDirections {
  const fieldDirection = (source: string | null | undefined, key?: string | null) =>
    (source === "page" ? pageFields : source === "entity" ? entityFields : [])
      .find((field) => field.fieldKey === key)?.textDirection ?? null;
  const languageDriven = (dimension?: Dimension | null) =>
    dimension?.source === "status" || dimension?.source === "statusTag";
  const multi = (pivot.measures?.length ?? 0) > 0;
  const measures = multi ? pivot.measures! : pivot.measure ? [pivot.measure] : [];
  return {
    row: fieldDirection(pivot.rows.source, pivot.rows.fieldKey),
    column: fieldDirection(pivot.cols?.source, pivot.cols?.fieldKey),
    rowLanguageDriven: languageDriven(pivot.rows),
    columnLanguageDriven: languageDriven(pivot.cols),
    columnIsMeasure: multi || !pivot.cols,
    measures: measures.map((measure, index) => ({
      measureKey: multi ? measure.key?.trim() || `m${index}` : null,
      textDirection: measure.agg === "sum" ? fieldDirection(measure.source, measure.fieldKey) : null,
    })),
  };
}