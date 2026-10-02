export type FormulaProvenanceField = {
  fieldKey: string;
  fieldType: string;
  formulaConfigJson?: unknown;
};

/**
 * Infer a formula result type only when the whole expression is a direct
 * entity-field reference. Qualified references are unambiguous; legacy flat
 * references are accepted only when a page field does not shadow the key.
 *
 * Keep this behavior aligned with the API's direct-formula-provenance helper.
 */
export function directEntityFormulaResultType(options: {
  formula: FormulaProvenanceField;
  entityId: number;
  entityFields: readonly FormulaProvenanceField[];
  pageFields: readonly FormulaProvenanceField[];
  /** Only metadata returned by an authorized related-field projection. */
  entityRelatedColumns?: readonly { fieldKey: string; relatedFieldType?: string | null }[];
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
  const field = options.entityFields.find((field) => field.fieldKey === fieldKey);
  if (!field) return null;
  // A lookup projects the target value; a relation instead yields the linked
  // record id, so it must not inherit its label field's type.
  if (field.fieldType === "lookup") {
    return options.entityRelatedColumns?.find((column) => column.fieldKey === fieldKey)?.relatedFieldType
      ?? field.fieldType;
  }
  return field.fieldType;
}

/**
 * Resolve presentation-only user labels for proven direct user formulas.
 * Non-user formula results remain untouched so numeric values keep their
 * calculation/filter semantics.
 */
export function directFormulaDisplayValue(
  value: unknown,
  resultType: string | null | undefined,
  userNames: ReadonlyMap<number, string>,
): unknown {
  if (resultType !== "user" || value == null || value === "") return value;
  const id = typeof value === "number" ? value : Number(value);
  return Number.isFinite(id) ? (userNames.get(id) ?? "—") : "—";
}

export type DirectFormulaPresentation =
  | { state: "value"; value: unknown }
  | { state: "pending" | "unavailable" };

/**
 * An unresolved direct lookup is not a numeric formula. Until the authorized
 * projection proves its type, withhold the value (including group commons).
 * No target-key guesses, numeric-id heuristics, or cross-scope type caches.
 */
export function directFormulaPresentation(
  value: unknown,
  resultType: string | null | undefined,
  userNames: ReadonlyMap<number, string>,
  states: {
    metadata: "pending" | "ready" | "unavailable";
    users: "pending" | "ready" | "unavailable";
  },
): DirectFormulaPresentation {
  if (value == null || value === "") return { state: "value", value };
  if (resultType === "lookup") {
    return { state: states.metadata === "pending" ? "pending" : "unavailable" };
  }
  if (resultType !== "user") return { state: "value", value };
  const id = typeof value === "number" ? value : Number(value);
  const name = Number.isFinite(id) ? userNames.get(id) : undefined;
  if (name != null) return { state: "value", value: name };
  return { state: states.users === "pending" ? "pending" : "unavailable" };
}