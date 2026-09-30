/** Draft IDs never belong in valuesJson; submit them as normalized selections. */
export function relationDraftIds(value: unknown): number[] {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? [value] : [];
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const ids: unknown = JSON.parse(value);
      return Array.isArray(ids) ? [...new Set(ids.filter((id): id is number => Number.isInteger(id) && id > 0))] : [];
    } catch { return []; }
  }
  return [];
}

export function draftRelationSelections(
  fields: { fieldKey: string; fieldType: string }[],
  form: Record<string, unknown>,
) {
  return fields.filter(f => f.fieldType === "relation" && form[f.fieldKey] != null && form[f.fieldKey] !== "")
    .map(f => ({ fieldKey: f.fieldKey, linkedRecordIds: relationDraftIds(form[f.fieldKey]) }));
}