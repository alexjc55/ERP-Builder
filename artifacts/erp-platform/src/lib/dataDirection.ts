export type DataDirection = "ltr" | "rtl";

/** Data flow is independent of UI geometry (table order, sticky offsets, icons). */
export function resolveDataDirection(
  field: DataDirection | null | undefined,
  page: DataDirection | null | undefined,
  app: DataDirection | null | undefined,
  uiLanguage: string,
): DataDirection {
  return field ?? page ?? app ?? (uiLanguage === "he" ? "rtl" : "ltr");
}