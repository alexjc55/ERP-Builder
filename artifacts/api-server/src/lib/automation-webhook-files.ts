type FileLink = {
  kind: string;
  name: string;
  url: string;
  requiresAuthentication: boolean;
  fileId: string;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** Use only already-resolved projections, never raw stored values. Each item has
 * the same shape, so schema-inference consumers need not infer polymorphic fields.
 * null means this projection does not describe a file; [] means an empty file. */
function fileLinks(input: unknown, depth = 0): FileLink[] | null {
  const field = object(input);
  if (!field || field.error || depth > 10) return null;
  if (field.type === "file") {
    const values = Array.isArray(field.resolvedValue) ? field.resolvedValue : [field.resolvedValue];
    return values.flatMap(value => {
      const file = object(value);
      if (!file || typeof file.url !== "string") return [];
      return [{
        kind: String(file.kind ?? "server"), name: String(file.name ?? file.url), url: file.url,
        requiresAuthentication: file.requiresAuthentication === true,
        fileId: typeof file.fileId === "string" ? file.fileId : "",
      }];
    });
  }
  if (!["relation", "lookup"].includes(String(field.type)) || !Array.isArray(field.resolvedValue)) return null;
  const nested = field.resolvedValue.map(link => fileLinks(object(link)?.field, depth + 1));
  return nested.some(files => files !== null) ? nested.flatMap(files => files ?? []) : null;
}

export function webhookFileAliases(projections: readonly unknown[]) {
  const entityEntries: [string, FileLink[]][] = [];
  const pageEntries = new Map<string, [string, FileLink[]][]>();
  for (const input of projections) {
    const field = object(input);
    if (!field || typeof field.fieldKey !== "string") continue;
    const files = fileLinks(field);
    if (files === null) continue;
    if (field.pageId == null && field.contextPageId == null) {
      entityEntries.push([field.fieldKey, files]);
    } else if (typeof field.pageId === "number") {
      const key = String(field.pageId);
      if (!pageEntries.has(key)) pageEntries.set(key, []);
      pageEntries.get(key)!.push([field.fieldKey, files]);
    }
  }
  return {
    files: Object.fromEntries(entityEntries),
    pageFiles: Object.fromEntries([...pageEntries].map(([pageId, entries]) => [pageId, Object.fromEntries(entries)])),
  };
}
