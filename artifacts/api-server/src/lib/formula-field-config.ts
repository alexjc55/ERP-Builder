type FormulaFieldReference =
  | { scope: "entity"; fieldKey: string }
  | { scope: "page"; pageId: number; fieldKey: string };
type FormulaPageReferenceSource = {
  kind: "pageLocal"; key: string; pageId: number; fieldKey: string;
};
type FormulaExternalAggregateSource = {
  kind: "aggregate";
  key: string;
  targetEntityId: number;
  targetPageId?: number;
  value?: FormulaFieldReference;
  join:
    | { kind: "relation"; relationId: number; baseSide: "source" | "target" }
    | { kind: "equality"; on: Array<{ base: FormulaFieldReference; target: FormulaFieldReference }> };
  aggregate: "sum" | "average" | "min" | "max" | "count" | "uniqueJoin";
  limit?: number;
  separator?: string;
};
type FormulaFieldSource = FormulaPageReferenceSource | FormulaExternalAggregateSource;

export const FORMULA_CONFIG_LIMITS = {
  expressionLength: 10_000,
  sourceCount: 32,
  tokenLength: 200,
  fieldKeyLength: 200,
  uniqueJoinSeparatorLength: 100,
  equalityJoinCount: 8,
  aggregateLimit: 10_000,
  groupResultFieldCount: 8,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const positiveInteger = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const boundedText = (value: unknown, limit: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= limit ? text : null;
};

function normalizePageSource(source: Record<string, unknown>): FormulaPageReferenceSource | null {
  const key = boundedText(source.key, FORMULA_CONFIG_LIMITS.tokenLength);
  const pageId = positiveInteger(source.pageId);
  const fieldKey = boundedText(source.fieldKey, FORMULA_CONFIG_LIMITS.fieldKeyLength);
  return key && pageId && fieldKey ? { kind: "pageLocal", key, pageId, fieldKey } : null;
}

function normalizeFieldReference(input: unknown): FormulaFieldReference | null {
  if (!isRecord(input)) return null;
  const fieldKey = boundedText(input.fieldKey, FORMULA_CONFIG_LIMITS.fieldKeyLength);
  if (!fieldKey) return null;
  if (input.scope === "entity") return { scope: "entity", fieldKey };
  if (input.scope === "page") {
    const pageId = positiveInteger(input.pageId);
    return pageId ? { scope: "page", pageId, fieldKey } : null;
  }
  return null;
}

function normalizeGroupResult(input: unknown): {
  enabled: boolean;
  fields: FormulaFieldReference[];
} | null {
  if (!isRecord(input) || typeof input.enabled !== "boolean" || !Array.isArray(input.fields)) {
    return null;
  }
  const fields: FormulaFieldReference[] = [];
  const seen = new Set<string>();
  for (const item of input.fields.slice(0, FORMULA_CONFIG_LIMITS.groupResultFieldCount)) {
    const ref = normalizeFieldReference(item);
    if (!ref) continue;
    const key = ref.scope === "entity"
      ? `entity:${ref.fieldKey}`
      : `page:${ref.pageId}:${ref.fieldKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push(ref);
  }
  return { enabled: input.enabled, fields };
}

function normalizeExternalSource(
  source: Record<string, unknown>,
): FormulaExternalAggregateSource | null {
  const key = boundedText(source.key, FORMULA_CONFIG_LIMITS.tokenLength);
  const targetEntityId = positiveInteger(source.targetEntityId);
  const value = source.value == null ? null : normalizeFieldReference(source.value);
  if (!key || !targetEntityId || (source.value != null && !value) || !isRecord(source.join)) return null;

  let join: FormulaExternalAggregateSource["join"];
  if (source.join.kind === "relation") {
    const relationId = positiveInteger(source.join.relationId);
    if (!relationId || (source.join.baseSide !== "source" && source.join.baseSide !== "target")) return null;
    join = { kind: "relation", relationId, baseSide: source.join.baseSide };
  } else if (source.join.kind === "equality") {
    if (!Array.isArray(source.join.on) || source.join.on.length < 1 ||
        source.join.on.length > FORMULA_CONFIG_LIMITS.equalityJoinCount) return null;
    const on = source.join.on.map((pair) => {
      if (!isRecord(pair)) return null;
      const base = normalizeFieldReference(pair.base);
      const target = normalizeFieldReference(pair.target);
      return base && target ? { base, target } : null;
    });
    if (on.some((pair) => pair == null)) return null;
    join = { kind: "equality", on: on as Array<{ base: FormulaFieldReference; target: FormulaFieldReference }> };
  } else {
    return null;
  }

  const aggregate = source.aggregate;
  if (!["sum", "average", "min", "max", "count", "uniqueJoin"].includes(String(aggregate))) {
    return null;
  }
  if (aggregate !== "count" && !value) return null;
  const targetPageId = source.targetPageId == null ? null : positiveInteger(source.targetPageId);
  if (source.targetPageId != null && !targetPageId) return null;
  const limitNumber = source.limit == null ? null : Number(source.limit);
  if (limitNumber != null && (!Number.isInteger(limitNumber) || limitNumber < 0 ||
      limitNumber > FORMULA_CONFIG_LIMITS.aggregateLimit)) return null;
  if (value?.scope === "page" && targetPageId !== value.pageId) return null;
  const separator = typeof source.separator === "string" &&
    source.separator.length <= FORMULA_CONFIG_LIMITS.uniqueJoinSeparatorLength
    ? source.separator : undefined;
  return {
    kind: "aggregate",
    key,
    targetEntityId,
    ...(targetPageId ? { targetPageId } : {}),
    ...(value ? { value } : {}),
    join,
    aggregate: aggregate as FormulaExternalAggregateSource["aggregate"],
    ...(limitNumber != null ? { limit: limitNumber } : {}),
    ...(aggregate === "uniqueJoin" && separator !== undefined ? { separator } : {}),
  };
}

/** Normalize and reject malformed structured sources at the write boundary. */
export function normalizeFormulaFieldSources(input: unknown): FormulaFieldSource[] {
  if (!Array.isArray(input)) return [];
  const result: FormulaFieldSource[] = [];
  const keys = new Set<string>();
  for (const item of input.slice(0, FORMULA_CONFIG_LIMITS.sourceCount)) {
    if (!isRecord(item)) continue;
    const source =
      item.kind === "pageLocal"
        ? normalizePageSource(item)
        : item.kind === "aggregate"
          ? normalizeExternalSource(item)
          : null;
    if (!source || keys.has(source.key)) continue;
    keys.add(source.key);
    result.push(source);
  }
  return result;
}

/** Returns actionable validation messages; normalization itself remains non-throwing. */
export function validateFormulaFieldConfig(config: unknown): string[] {
  if (!isRecord(config)) return ["formulaConfigJson must be an object"];
  const errors: string[] = [];
  if (typeof config.expression === "string" && config.expression.length > FORMULA_CONFIG_LIMITS.expressionLength) {
    errors.push(`expression exceeds ${FORMULA_CONFIG_LIMITS.expressionLength} characters`);
  }
  if (config.sources !== undefined) {
    if (!Array.isArray(config.sources)) errors.push("sources must be an array");
    else {
      const sourceList = config.sources;
      if (config.sources.length > FORMULA_CONFIG_LIMITS.sourceCount) {
        errors.push(`sources exceeds ${FORMULA_CONFIG_LIMITS.sourceCount} entries`);
      }
      const normalized = normalizeFormulaFieldSources(config.sources);
      if (normalized.length !== Math.min(sourceList.length, FORMULA_CONFIG_LIMITS.sourceCount) ||
          normalized.some((source, index) => JSON.stringify(source) !== JSON.stringify(sourceList[index]))) {
        errors.push("sources contains malformed or duplicate entries");
      }
    }
  }
  if (config.groupResult !== undefined) {
    const normalized = normalizeGroupResult(config.groupResult);
    if (
      !normalized ||
      !isRecord(config.groupResult) ||
      !Array.isArray(config.groupResult.fields) ||
      config.groupResult.fields.length > FORMULA_CONFIG_LIMITS.groupResultFieldCount ||
      JSON.stringify(normalized) !== JSON.stringify(config.groupResult)
    ) {
      errors.push("groupResult contains malformed or duplicate field references");
    } else if (normalized.enabled && normalized.fields.length === 0) {
      errors.push("groupResult.fields must not be empty when enabled");
    }
  }
  return errors;
}

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
    expression?: unknown;
    decimals?: unknown;
    displayAffix?: unknown;
    displayAffixPosition?: unknown;
    sources?: unknown;
    groupResult?: unknown;
  };
  let normalized: Record<string, unknown> = { ...(config as object) };

  if ("decimals" in source && source.decimals != null) {
    const value = Number(source.decimals);
    normalized = {
      ...normalized,
      decimals: Number.isFinite(value) ? Math.min(10, Math.max(0, Math.round(value))) : null,
    };
  }

  if ("expression" in source && typeof source.expression === "string") {
    normalized.expression = source.expression.trim().slice(0, FORMULA_CONFIG_LIMITS.expressionLength);
  }
  if ("sources" in source) {
    normalized.sources = fieldType === "function" ? normalizeFormulaFieldSources(source.sources) : [];
  }
  if ("groupResult" in source) {
    const groupResult = normalizeGroupResult(source.groupResult);
    if (fieldType === "function" && groupResult) normalized.groupResult = groupResult;
    else delete normalized.groupResult;
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