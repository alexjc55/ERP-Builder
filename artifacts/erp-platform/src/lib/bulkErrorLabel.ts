/** Only caller-supplied, currently visible scalar fields may identify a row. */
export function bulkErrorLabel(
  error: unknown,
  message: string | undefined,
  rows: readonly { id: number; valuesJson?: unknown }[],
  selectedIds: ReadonlySet<number>,
  visibleFields: readonly { fieldKey: string; fieldType: string }[],
  rowCaption: string,
): string | undefined {
  const recordId = (error as { data?: { recordId?: unknown } } | null)?.data?.recordId;
  if (typeof recordId !== "number" || !selectedIds.has(recordId)) return message;
  const index = rows.findIndex(row => row.id === recordId);
  if (index < 0) return message;
  const values = (rows[index].valuesJson ?? {}) as Record<string, unknown>;
  const labels = visibleFields
    .filter(field => ["text", "number"].includes(field.fieldType))
    .map(field => values[field.fieldKey])
    .filter((value): value is string | number =>
      (typeof value === "string" && value.trim().length > 0) || typeof value === "number")
    .slice(0, 2)
    .map(value => String(value).slice(0, 100));
  const detail = message?.replace(new RegExp(`^Запись ${recordId}:\\s*`), "") ?? "";
  return `${rowCaption} ${index + 1}${labels.length ? ` — ${labels.join(" · ")}` : ""} (#${recordId}): ${detail}`;
}