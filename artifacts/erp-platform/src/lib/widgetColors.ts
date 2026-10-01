/** Legacy tokens remain stored verbatim; arbitrary CSS is never accepted. */
export const WIDGET_PRESET_HEX: Record<string, string> = {
  "bg-blue-600": "#2563eb",
  "bg-violet-600": "#7c3aed",
  "bg-emerald-600": "#059669",
  "bg-amber-500": "#f59e0b",
  "bg-red-500": "#ef4444",
  "bg-cyan-600": "#0891b2",
  "bg-pink-600": "#db2777",
  "bg-slate-600": "#475569",
};

export function normalizeWidgetColor(value: string): string | null {
  if (Object.hasOwn(WIDGET_PRESET_HEX, value)) return value;
  const hex = value.trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
}

export function widgetColorHex(value?: string | null): string {
  const normalized = normalizeWidgetColor(value ?? "");
  return normalized ? WIDGET_PRESET_HEX[normalized] ?? normalized : WIDGET_PRESET_HEX["bg-blue-600"];
}