type SurfaceValue = string | number | boolean | null;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** Read the existing, permission/authority-resolved projection, not raw IDs.
 * Numeric results stay numeric; multiple links are not implicitly summed. */
function surfaceValue(input: unknown, depth = 0): SurfaceValue {
  const field = object(input);
  if (!field || field.error || depth > 10) return null;
  const value = field.resolvedValue;
  if (value == null) return null;
  const combine = (values: SurfaceValue[]): SurfaceValue => {
    const present = values.filter(v => v !== null && v !== "");
    if (!present.length) return null;
    return present.length === 1 ? present[0]! : present.join(", ");
  };
  if (field.type === "relation" || field.type === "lookup") {
    return Array.isArray(value) ? combine(value.map(link => surfaceValue(object(link)?.field, depth + 1))) : null;
  }
  if (field.type === "file" || field.type === "user") {
    const values = Array.isArray(value) ? value : [value];
    return combine(values.map(item => {
      const text = object(item)?.[field.type === "file" ? "url" : "name"];
      return typeof text === "string" ? text : null;
    }));
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && !value.length) return null;
  return typeof field.displayValue === "string" ? field.displayValue
    : typeof value === "string" ? value : null;
}

export function webhookDisplayValues(projections: readonly unknown[]) {
  const entityEntries: [string, SurfaceValue][] = [];
  const pages = new Map<string, { contextual: [string, SurfaceValue][]; local: [string, SurfaceValue][] }>();
  for (const input of projections) {
    const field = object(input);
    if (!field || typeof field.fieldKey !== "string") continue;
    const entry: [string, SurfaceValue] = [field.fieldKey, surfaceValue(field)];
    const pageId = field.pageId ?? field.contextPageId;
    if (pageId == null) entityEntries.push(entry);
    else if (typeof pageId === "number") {
      const key = String(pageId);
      if (!pages.has(key)) pages.set(key, { contextual: [], local: [] });
      pages.get(key)![field.pageId == null ? "contextual" : "local"].push(entry);
    }
  }
  return {
    displayValues: Object.fromEntries(entityEntries),
    pageDisplayValues: Object.fromEntries([...pages].map(([key, values]) =>
      [key, Object.fromEntries([...values.contextual, ...values.local])])),
  };
}
