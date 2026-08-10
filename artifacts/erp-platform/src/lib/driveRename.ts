import { getGoogleDriveNameTemplate, renameGoogleDriveFile } from "@workspace/api-client-react";
import { composeDriveFileName, type DriveNameSection } from "@/lib/driveNaming";

/** Minimal field shape needed to resolve a file field's name template. */
type FileTemplateField = {
  fieldKey: string;
  fieldType: string;
  isActive?: boolean;
  fileConfigJson?: { driveFolderId?: string; nameTemplateJson?: unknown } | null;
};

/**
 * After a record is SAVED, re-check Drive file names against the FINAL field
 * values. Files upload mid-form (before save), so name-template field sections
 * may have been empty at upload time; this pass renames the Drive file (and the
 * stored value's name — done server-side) once the real values are known.
 * Best-effort: failures are swallowed; the record itself is already saved.
 * Returns true when at least one file was renamed (caller may re-invalidate).
 */
export async function maybeRenameDriveFiles(opts: {
  recordId: number;
  fields: FileTemplateField[];
  /** FINAL saved values (entity fields; page-local values may be merged in for template resolution). */
  values: Record<string, unknown>;
  uploaderEmail?: string | null;
}): Promise<boolean> {
  const { recordId, fields, values, uploaderEmail } = opts;
  let renamed = false;
  const folderTemplateCache = new Map<string, DriveNameSection[]>();
  for (const f of fields) {
    if (f.fieldType !== "file" || f.isActive === false) continue;
    const v = values[f.fieldKey] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object" || v.kind !== "gdrive" || !v.fileId || typeof v.name !== "string") continue;
    try {
      // Field template wins; else the target folder's template (default folder when unset).
      let template = (f.fileConfigJson?.nameTemplateJson ?? []) as DriveNameSection[];
      if (template.length === 0) {
        const folderKey = f.fileConfigJson?.driveFolderId ?? "";
        let cached = folderTemplateCache.get(folderKey);
        if (!cached) {
          const resp = await getGoogleDriveNameTemplate(folderKey ? { driveFolderId: folderKey } : {});
          cached = (resp.sections ?? []) as DriveNameSection[];
          folderTemplateCache.set(folderKey, cached);
        }
        template = cached;
      }
      if (template.length === 0) continue;
      const expected = composeDriveFileName(v.name as string, template, values, uploaderEmail);
      if (!expected || expected === v.name) continue;
      await renameGoogleDriveFile({ recordId, fieldKey: f.fieldKey, fileId: v.fileId as string, name: expected });
      renamed = true;
    } catch {
      // Best-effort: never surface rename problems as a save error.
    }
  }
  return renamed;
}
