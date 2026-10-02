type Language = "ru" | "en" | "he";
type Names = Partial<Record<Language, string>>;

/** Preserve the language of the displayed translation, not the surrounding UI. */
export function statusTextPresentation(names: Names | null | undefined, language: Language, fallback = "") {
  for (const candidate of [language, "ru", "en", "he"] as const) {
    const text = names?.[candidate];
    if (text?.trim()) return { text, direction: candidate === "he" ? "rtl" as const : "ltr" as const };
  }
  // Legacy projections may contain only a pretranslated string.
  return { text: fallback, direction: /[\u0590-\u05ff]/u.test(fallback) ? "rtl" as const : "ltr" as const };
}