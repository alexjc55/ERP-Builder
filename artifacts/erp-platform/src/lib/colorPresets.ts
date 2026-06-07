/**
 * Small localStorage-backed palette of saved colors, shared across every color
 * control (conditional-formatting cell/row colors) so a color chosen once can be
 * reused on other fields without memorizing its hex code.
 */
const STORAGE_KEY = "erp.colorPresets";
const MAX_PRESETS = 24;

export function loadColorPresets(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string").slice(0, MAX_PRESETS)
      : [];
  } catch {
    return [];
  }
}

export function saveColorPresets(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_PRESETS)));
  } catch {
    /* ignore quota/availability errors — presets are a convenience, not critical */
  }
}

/** Add a color to the front of the palette (de-duplicated, capped). */
export function addColorPreset(list: string[], hex: string): string[] {
  const next = [hex, ...list.filter((p) => p.toLowerCase() !== hex.toLowerCase())].slice(0, MAX_PRESETS);
  saveColorPresets(next);
  return next;
}

export function removeColorPreset(list: string[], hex: string): string[] {
  const next = list.filter((p) => p.toLowerCase() !== hex.toLowerCase());
  saveColorPresets(next);
  return next;
}
