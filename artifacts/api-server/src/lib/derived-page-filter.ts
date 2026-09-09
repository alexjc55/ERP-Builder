export const LINKED_FILTER_VALUE_PREFIX = "__linked__:";
const EMPTY_FILTER_VALUE = "__empty__";

export interface DerivedRuntimeValue {
  raw: unknown;
  display?: string;
  linkedId?: number;
  fieldType?: string | null;
}

export function isDerivedRuntimeValue(value: unknown): value is DerivedRuntimeValue {
  return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "raw");
}

export function derivedRawValue(value: unknown): unknown {
  return isDerivedRuntimeValue(value) ? value.raw : value;
}

export function derivedWireValue(value: unknown): string {
  if (isDerivedRuntimeValue(value) && value.linkedId != null) {
    return linkedFilterValue(value.linkedId, value.display ?? value.raw);
  }
  const raw = derivedRawValue(value);
  return raw == null ? "" : String(raw);
}

type DerivedFilterCondition = {
  field?: string;
  operator:
    | "eq" | "neq" | "contains" | "not_contains" | "starts_with" | "ends_with"
    | "gt" | "gte" | "lt" | "lte" | "in" | "between" | "is_empty" | "is_not_empty";
  value?: unknown;
};

export function validateDerivedFilterCondition(condition: DerivedFilterCondition): string | null {
  if (condition.operator === "is_empty" || condition.operator === "is_not_empty") return null;
  if (condition.operator === "in") {
    return Array.isArray(condition.value)
      && condition.value.length > 0
      && condition.value.every((value) =>
        value !== null &&
        value !== undefined &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
      ? null
      : '"in" requires a non-empty array of scalar operands';
  }
  if (condition.operator === "between") {
    return Array.isArray(condition.value)
      && condition.value.length === 2
      && condition.value.every((value) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        (typeof value === "string" || typeof value === "number"))
      ? null
      : '"between" requires exactly two scalar bounds';
  }
  if (
    condition.value == null ||
    condition.value === "" ||
    (typeof condition.value !== "string" &&
      typeof condition.value !== "number" &&
      typeof condition.value !== "boolean")
  ) {
    return `"${condition.operator}" requires a scalar value`;
  }
  if (
    (condition.operator === "contains" ||
      condition.operator === "not_contains" ||
      condition.operator === "starts_with" ||
      condition.operator === "ends_with") &&
    typeof condition.value !== "string"
  ) {
    return `"${condition.operator}" requires a text operand`;
  }
  return condition.value == null || condition.value === ""
    ? `"${condition.operator}" requires a value`
    : null;
}

export function validateDerivedOperandType(
  condition: DerivedFilterCondition,
  values: Iterable<unknown>,
): string | null {
  const sample = [...values].find((value) => {
    const raw = derivedRawValue(value);
    return raw != null && raw !== "";
  });
  if (sample == null) return null;
  const runtime = isDerivedRuntimeValue(sample) ? sample : undefined;
  const raw = derivedRawValue(sample);
  const type = runtime?.fieldType;
  const operands = condition.operator === "between" || condition.operator === "in"
    ? condition.value as unknown[]
    : [condition.value];
  if (runtime?.linkedId != null && (condition.operator === "eq" || condition.operator === "neq" || condition.operator === "in")) {
    return operands.every((operand) => {
      const match = /^__linked__:(\d+)(?::.*)?$/.exec(String(operand));
      return match != null && Number(match[1]) > 0;
    }) ? null : `"${condition.operator}" requires linked record operand(s)`;
  }
  if (type === "number" || type === "percent" || typeof raw === "number") {
    return operands.every((operand) =>
      operand !== "" &&
      typeof operand !== "boolean" &&
      Number.isFinite(Number(operand)))
      ? null
      : `"${condition.operator}" requires numeric operand(s)`;
  }
  if (type === "date" || type === "datetime") {
    return operands.every((operand) => Number.isFinite(Date.parse(String(operand))))
      ? null
      : `"${condition.operator}" requires valid date operand(s)`;
  }
  if (
    condition.operator === "gt" ||
    condition.operator === "gte" ||
    condition.operator === "lt" ||
    condition.operator === "lte" ||
    condition.operator === "between"
  ) {
    return `"${condition.operator}" requires a numeric or date result`;
  }
  return null;
}

export function linkedFilterValue(id: number, label: unknown): string {
  return `${LINKED_FILTER_VALUE_PREFIX}${id}:${encodeURIComponent(
    label == null || label === "" ? `#${id}` : String(label),
  )}`;
}

/** A label is presentation metadata; linked-filter equality is record-id based. */
export function stableDerivedFilterValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!text.startsWith(LINKED_FILTER_VALUE_PREFIX)) return text;
  const separator = text.indexOf(":", LINKED_FILTER_VALUE_PREFIX.length);
  return separator < 0 ? text : text.slice(0, separator);
}

export function derivedFilterDisplayValue(value: unknown): string {
  if (isDerivedRuntimeValue(value)) {
    return value.display ?? (value.raw == null ? "" : String(value.raw));
  }
  const text = value == null ? "" : String(value);
  if (!text.startsWith(LINKED_FILTER_VALUE_PREFIX)) return text;
  const separator = text.indexOf(":", LINKED_FILTER_VALUE_PREFIX.length);
  if (separator < 0) return text;
  try {
    return decodeURIComponent(text.slice(separator + 1));
  } catch {
    return text.slice(separator + 1);
  }
}

export function derivedPageValueMatches(
  value: unknown,
  condition: DerivedFilterCondition,
  fieldType?: string,
): boolean {
  const runtime = isDerivedRuntimeValue(value) ? value : undefined;
  const rawValue = derivedRawValue(value);
  const effectiveType = runtime?.fieldType ?? fieldType;
  const op = condition.operator;
  const empty = rawValue == null || rawValue === "";
  const text = empty ? "" : String(rawValue);
  if (op === "is_empty") return empty;
  if (op === "is_not_empty") return !empty;
  if (op === "in") {
    if (!Array.isArray(condition.value) || condition.value.length === 0) return false;
    const choices = condition.value.map(stableDerivedFilterValue);
    if (runtime?.linkedId != null) {
      return choices.includes(`${LINKED_FILTER_VALUE_PREFIX}${runtime.linkedId}`);
    }
    if (effectiveType === "number" || effectiveType === "percent" || typeof rawValue === "number") {
      const current = Number(rawValue);
      return !empty && Number.isFinite(current) && condition.value.some((choice) => {
        if (choice === "" || typeof choice === "boolean") return false;
        const candidate = Number(choice);
        return Number.isFinite(candidate) && candidate === current;
      });
    }
    return (empty && choices.includes(EMPTY_FILTER_VALUE)) || choices.includes(stableDerivedFilterValue(text));
  }
  if (op === "between") {
    const bounds = Array.isArray(condition.value) ? condition.value : [];
    if (bounds.length !== 2 || empty || bounds.some((bound) => bound == null || bound === "")) return false;
    if (effectiveType === "date" || effectiveType === "datetime") {
      const current = Date.parse(text);
      const from = Date.parse(String(bounds[0]));
      const to = Date.parse(String(bounds[1]));
      return [current, from, to].every(Number.isFinite) && current >= from && current < to;
    }
    const number = Number(rawValue);
    const loNumber = Number(bounds[0]);
    const hiNumber = Number(bounds[1]);
    if (
      effectiveType === "number" ||
      effectiveType === "percent" ||
      typeof rawValue === "number"
    ) {
      return [number, loNumber, hiNumber].every(Number.isFinite)
        && number >= loNumber
        && number < hiNumber;
    }
    return text >= String(bounds[0]) && text < String(bounds[1]);
  }
  const rhs = String(condition.value ?? "");
  if (op === "eq" || op === "neq") {
    let equal: boolean;
    if (runtime?.linkedId != null) {
      equal = stableDerivedFilterValue(rhs) === `${LINKED_FILTER_VALUE_PREFIX}${runtime.linkedId}`;
    } else if (effectiveType === "number" || effectiveType === "percent" || typeof rawValue === "number") {
      const left = Number(rawValue);
      const right = Number(condition.value);
      equal = Number.isFinite(left) && Number.isFinite(right) && left === right;
    } else {
      equal = !empty && text === rhs;
    }
    return op === "eq" ? equal : !equal;
  }
  const display = derivedFilterDisplayValue(runtime ?? text).toLocaleLowerCase();
  if (op === "contains") return !empty && display.includes(rhs.toLocaleLowerCase());
  if (op === "not_contains") return empty || !display.includes(rhs.toLocaleLowerCase());
  if (op === "starts_with") return !empty && display.startsWith(rhs.toLocaleLowerCase());
  if (op === "ends_with") return !empty && display.endsWith(rhs.toLocaleLowerCase());
  if (empty) return false;
  let comparison: number;
  if (effectiveType === "date" || effectiveType === "datetime") {
    comparison = Date.parse(text) - Date.parse(rhs);
  } else {
    comparison = Number(rawValue) - Number(condition.value);
  }
  if (op === "gt") return comparison > 0;
  if (op === "gte") return comparison >= 0;
  if (op === "lt") return comparison < 0;
  if (op === "lte") return comparison <= 0;
  return false;
}