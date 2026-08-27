export type InboundOperand =
  | { kind: "source"; path: string }
  | { kind: "result"; step: string; property?: "id" }
  | { kind: "static"; value: unknown };

export type InboundTransform =
  | "trim" | "lower" | "upper" | "normalize_email" | "normalize_phone"
  | "string" | "number" | "boolean" | "date";

export interface InboundValue {
  operand: InboundOperand;
  transforms?: InboundTransform[];
  default?: unknown;
  concat?: { values: InboundOperand[]; separator?: string };
}

export interface InboundMatch {
  kind: "system_id" | "external" | "fields";
  value?: InboundValue;
  objectType?: string;
  conditions?: { fieldKey: string; value: InboundValue }[];
  parent?: { fieldKey: string; step: string };
  onMissingExplicitId?: "error" | "continue";
  skipWhenEmpty?: boolean;
}

export interface InboundStep {
  key: string;
  source?: string;
  target:
    | { kind: "entity" | "page"; entityId: number; pageId?: number }
    | { kind: "user"; fieldId: number; roleId: number; entityId?: never; pageId?: number };
  operation: "find" | "create" | "update" | "upsert";
  matches?: InboundMatch[];
  values?: Record<string, InboundValue>;
  externalId?: { objectType: string; value: InboundValue };
  /** Fixed relation metadata; target records can only be prior step results. */
  links?: { relationId: number; toStep: string }[];
}

export interface InboundMapping { atomic?: boolean; steps: InboundStep[] }

const STEP_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
const ALLOWED_TRANSFORMS = new Set<InboundTransform>([
  "trim", "lower", "upper", "normalize_email", "normalize_phone",
  "string", "number", "boolean", "date",
]);

export function validateInboundMapping(input: unknown): { ok: true; mapping: InboundMapping } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["Mapping must be an object"] };
  const candidate = input as Partial<InboundMapping>;
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0 || candidate.steps.length > 50) {
    return { ok: false, errors: ["Mapping must contain 1..50 ordered steps"] };
  }
  const seen = new Set<string>();
  candidate.steps.forEach((step, index) => {
    const at = `steps[${index}]`;
    if (!step || typeof step !== "object") { errors.push(`${at} must be an object`); return; }
    if (!STEP_KEY.test(step.key ?? "") || seen.has(step.key)) errors.push(`${at}.key is invalid or duplicate`);
    if (!["find", "create", "update", "upsert"].includes(step.operation)) errors.push(`${at}.operation is invalid`);
    if (!step.target || !["entity", "page", "user"].includes(step.target.kind)) {
      errors.push(`${at}.target is invalid`);
    } else if (step.target.kind === "user") {
      if (!Number.isInteger(step.target.fieldId) || step.target.fieldId <= 0 || !Number.isInteger(step.target.roleId) || step.target.roleId <= 0)
        errors.push(`${at}.target must contain fixed positive fieldId and roleId`);
    } else if (!Number.isInteger(step.target.entityId) || step.target.entityId <= 0) {
      errors.push(`${at}.target must contain a fixed positive entityId`);
    }
    if (step.target?.kind === "page" && (!Number.isInteger(step.target.pageId) || (step.target.pageId ?? 0) <= 0)) {
      errors.push(`${at}.target.pageId is required`);
    }
    for (const key of Object.keys(step.values ?? {})) if (!FIELD_KEY.test(key)) errors.push(`${at}.values has invalid field key ${key}`);
    for (const [key, value] of Object.entries(step.values ?? {})) validateValue(value, `${at}.values.${key}`, seen, errors);
    for (const link of step.links ?? []) {
      if (!Number.isInteger(link.relationId) || link.relationId <= 0 || !seen.has(link.toStep)) errors.push(`${at}.links must reference an earlier step and fixed relation`);
    }
    for (const [mi, match] of (step.matches ?? []).entries()) {
      if (!["system_id", "external", "fields"].includes(match.kind)) errors.push(`${at}.matches[${mi}].kind is invalid`);
      if (match.kind === "fields" && (!match.conditions?.length || match.conditions.length > 10)) errors.push(`${at}.matches[${mi}] needs 1..10 AND conditions`);
      for (const condition of match.conditions ?? []) {
        if (!FIELD_KEY.test(condition.fieldKey)) errors.push(`${at}.matches[${mi}] has invalid field key`);
        validateValue(condition.value, `${at}.matches[${mi}]`, seen, errors);
      }
      if (match.value) validateValue(match.value, `${at}.matches[${mi}].value`, seen, errors);
      if (match.parent && (!seen.has(match.parent.step) || match.parent.step === step.key)) errors.push(`${at}.matches[${mi}].parent references a later/unknown step`);
    }
    seen.add(step.key);
  });
  return errors.length ? { ok: false, errors } : { ok: true, mapping: candidate as InboundMapping };
}

function validateValue(value: InboundValue, at: string, seen: Set<string>, errors: string[]): void {
  if (!value || typeof value !== "object" || !value.operand) { errors.push(`${at} must contain an operand`); return; }
  const operand = value.operand;
  if (!["source", "result", "static"].includes(operand.kind)) errors.push(`${at}.operand.kind is invalid`);
  if (operand.kind === "source" && (typeof operand.path !== "string" || operand.path.length > 500)) errors.push(`${at}.operand.path is invalid`);
  if (operand.kind === "result" && !seen.has(operand.step)) errors.push(`${at} references a later/unknown step`);
  for (const transform of value.transforms ?? []) if (!ALLOWED_TRANSFORMS.has(transform)) errors.push(`${at} contains an unsafe transform`);
}

/** Dot/bracket path reader. It never evaluates code or follows prototype keys. */
export function readInboundPath(root: unknown, path: string): unknown {
  if (path === "" || path === "$") return root;
  const parts = path.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let value: unknown = root;
  for (const part of parts) {
    if (part === "__proto__" || part === "prototype" || part === "constructor") return undefined;
    if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
    else if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part)) value = (value as Record<string, unknown>)[part];
    else return undefined;
  }
  return value;
}

export function resolveInboundValue(spec: InboundValue, source: unknown, results: Map<string, { id: number }>): unknown {
  let value: unknown;
  if (spec.concat) {
    value = spec.concat.values.map((o) => resolveOperand(o, source, results) ?? "").join(spec.concat.separator ?? "");
  } else value = resolveOperand(spec.operand, source, results);
  if ((value == null || value === "") && "default" in spec) value = spec.default;
  for (const transform of spec.transforms ?? []) value = applyTransform(transform, value);
  return value;
}

function resolveOperand(operand: InboundOperand, source: unknown, results: Map<string, { id: number }>): unknown {
  if (operand.kind === "source") return readInboundPath(source, operand.path);
  if (operand.kind === "result") return results.get(operand.step)?.id;
  return operand.value;
}

function applyTransform(transform: InboundTransform, value: unknown): unknown {
  if (transform === "trim") return String(value ?? "").trim();
  if (transform === "lower" || transform === "normalize_email") return String(value ?? "").trim().toLowerCase();
  if (transform === "upper") return String(value ?? "").trim().toUpperCase();
  if (transform === "normalize_phone") return String(value ?? "").replace(/[^\d+]/g, "");
  if (transform === "string") return String(value ?? "");
  if (transform === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("Transform produced an invalid number");
    return n;
  }
  if (transform === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    throw new Error("Transform produced an invalid boolean");
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.valueOf())) throw new Error("Transform produced an invalid date");
  return date.toISOString();
}