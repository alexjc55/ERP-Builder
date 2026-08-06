import type { FieldFormatRule } from "@workspace/api-client-react";

/**
 * Conditional formatting for record cells. Each field may carry an ordered list
 * of rules; the first matching rule per field wins. A matched rule can colour
 * the cell and/or the whole row. When several fields each set a row colour, the
 * first field (in column order) wins.
 *
 * Boolean fields are matched with the `equals` operator against the strings
 * "true"/"false" (there is no dedicated boolean operator in the contract).
 */

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

// ISO date / datetime prefix (what date, datetime and created_at values look
// like). Comparison operators treat such strings as timestamps so gt/lt/between
// work with datetime semantics, not failed numeric parses.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function asNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const s = v.trim();
    if (ISO_DATE_RE.test(s)) {
      const ts = Date.parse(s);
      return Number.isFinite(ts) ? ts : null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function ruleMatches(rule: FieldFormatRule, value: unknown): boolean {
  const target = rule.value ?? "";
  switch (rule.operator) {
    case "equals":
      return String(value ?? "") === String(target);
    case "notEquals":
      return String(value ?? "") !== String(target);
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(target).toLowerCase());
    case "notContains":
      return !String(value ?? "").toLowerCase().includes(String(target).toLowerCase());
    case "empty":
      return isEmpty(value);
    case "notEmpty":
      return !isEmpty(value);
    case "gt": {
      const a = asNum(value);
      const b = asNum(target);
      return a != null && b != null && a > b;
    }
    case "lt": {
      const a = asNum(value);
      const b = asNum(target);
      return a != null && b != null && a < b;
    }
    case "gte": {
      const a = asNum(value);
      const b = asNum(target);
      return a != null && b != null && a >= b;
    }
    case "lte": {
      const a = asNum(value);
      const b = asNum(target);
      return a != null && b != null && a <= b;
    }
    case "between": {
      // Inclusive range: value2 is the upper bound. Bounds may be entered in
      // either order, so normalize (min/max) before comparing.
      const a = asNum(value);
      const lo = asNum(target);
      const hi = asNum(rule.value2 ?? "");
      if (a == null || lo == null || hi == null) return false;
      return a >= Math.min(lo, hi) && a <= Math.max(lo, hi);
    }
    default:
      return false;
  }
}

export interface FormatField {
  fieldKey: string;
  formatRulesJson?: FieldFormatRule[] | null;
}

export interface RowFormatting {
  cellColors: Record<string, string>;
  cellTextColors: Record<string, string>;
  rowColor?: string;
}

/**
 * Compute cell/row colours for one record. `getValue` returns the displayed
 * value for a field key (already computed for formula fields).
 */
export function computeRowFormatting(fields: FormatField[], getValue: (fieldKey: string) => unknown): RowFormatting {
  const cellColors: Record<string, string> = {};
  const cellTextColors: Record<string, string> = {};
  let rowColor: string | undefined;
  for (const field of fields) {
    const rules = field.formatRulesJson ?? [];
    if (rules.length === 0) continue;
    const value = getValue(field.fieldKey);
    for (const rule of rules) {
      if (ruleMatches(rule, value)) {
        if (rule.cellColor && !cellColors[field.fieldKey]) cellColors[field.fieldKey] = rule.cellColor;
        if (rule.textColor && !cellTextColors[field.fieldKey]) cellTextColors[field.fieldKey] = rule.textColor;
        if (rule.rowColor && !rowColor) rowColor = rule.rowColor;
        break;
      }
    }
  }
  return { cellColors, cellTextColors, rowColor };
}
