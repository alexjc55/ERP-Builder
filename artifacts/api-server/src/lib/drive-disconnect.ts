import { createHash } from "node:crypto";
import { db, googleDriveConnectionTable, googleDriveFoldersTable, type GoogleDriveConnection } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

type Executor = Pick<typeof db, "execute" | "select">;

/** OAuth state must track credentials/config, not incidental health-check timestamps. */
export function driveConnectionVersion(connection: GoogleDriveConnection | undefined) {
  return createHash("sha256").update(JSON.stringify(connection ? [
    connection.keyMode, connection.ownClientId, connection.ownClientSecretEnc,
    connection.refreshTokenEnc, connection.accountEmail, connection.folderId,
  ] : null)).digest("hex");
}

/** Aggregate stored references, not physical Drive ownership; never return record/file contents. */
export async function driveDisconnectPreview(tx: Executor = db) {
  const result = await tx.execute(sql`
    WITH connection AS (
      SELECT folder_id FROM google_drive_connection WHERE id=1
    ), mappings AS (
      SELECT 'entity:' || f.id AS field_id, f.entity_id, NULL::integer AS page_id,
        f.field_key, 'entity' AS source,
        COALESCE(NULLIF(f.file_config_json->>'driveFolderId',''), (SELECT folder_id FROM connection)) AS folder_id
      FROM entity_fields f
      WHERE f.field_type='file' AND (
        NULLIF(f.file_config_json->>'driveFolderId','') IS NOT NULL
        OR f.file_config_json->'allowedSources' ? 'gdrive')
      UNION ALL
      SELECT 'page:' || f.id, COALESCE(p.mirror_entity_id,e.id), f.page_id,
        f.field_key, 'page',
        COALESCE(NULLIF(f.file_config_json->>'driveFolderId',''), (SELECT folder_id FROM connection))
      FROM page_fields f JOIN pages p ON p.id=f.page_id
      LEFT JOIN entities e ON e.page_id=p.id
      WHERE f.field_type='file' AND (
        NULLIF(f.file_config_json->>'driveFolderId','') IS NOT NULL
        OR f.file_config_json->'allowedSources' ? 'gdrive')
    ), stored AS (
      SELECT m.folder_id, r.id AS record_id FROM mappings m
      JOIN entity_records r ON m.source='entity' AND r.entity_id=m.entity_id
      WHERE jsonb_path_exists(r.values_json->m.field_key, '$.** ? (@.kind == "gdrive" && exists(@.fileId))')
      UNION
      SELECT m.folder_id, v.record_id FROM mappings m
      JOIN page_record_values v ON m.source='page' AND v.page_id=m.page_id
      WHERE jsonb_path_exists(v.values_json->m.field_key, '$.** ? (@.kind == "gdrive" && exists(@.fileId))')
    ), folders AS (
      SELECT drive_folder_id AS folder_id, name FROM google_drive_folders
      UNION ALL
      SELECT DISTINCT m.folder_id, m.folder_id FROM mappings m
      WHERE m.folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM google_drive_folders f WHERE f.drive_folder_id=m.folder_id)
    )
    SELECT f.folder_id AS "folderId", f.name,
      (SELECT count(DISTINCT m.field_id)::int FROM mappings m WHERE m.folder_id=f.folder_id) AS fields,
      (SELECT count(DISTINCT m.entity_id)::int FROM mappings m WHERE m.folder_id=f.folder_id) AS entities,
      (SELECT count(DISTINCT m.page_id)::int FROM mappings m WHERE m.folder_id=f.folder_id) AS pages,
      (SELECT count(DISTINCT s.record_id)::int FROM stored s WHERE s.folder_id=f.folder_id) AS records
    FROM folders f ORDER BY f.folder_id
  `);
  const folders = result.rows as { folderId: string; name: string; fields: number; entities: number; pages: number; records: number }[];
  const [connection] = await tx.select().from(googleDriveConnectionTable).where(eq(googleDriveConnectionTable.id, 1));
  // Include exact bindings so equal aggregate counts cannot conceal reassignment.
  const bindings = await tx.execute(sql`
    SELECT 'entity' AS source, id, file_config_json AS config FROM entity_fields
    WHERE field_type='file'
    UNION ALL
    SELECT 'page', id, file_config_json FROM page_fields WHERE field_type='file'
    ORDER BY source,id
  `);
  const catalog = await tx.select().from(googleDriveFoldersTable).orderBy(googleDriveFoldersTable.id);
  const revision = createHash("sha256").update(JSON.stringify([folders, driveConnectionVersion(connection), bindings.rows, catalog])).digest("hex");
  return { folders, revision };
}

/** All settings updates and the destructive choice are committed atomically. */
export async function disconnectDrive(folderAction: "keep" | "forget", revision: string) {
  return db.transaction(async (tx) => {
    // Match lock order for both lifecycle mutations; counts are a fresh snapshot.
    await tx.execute(sql`LOCK TABLE google_drive_connection, google_drive_folders,
      entity_fields, page_fields IN SHARE ROW EXCLUSIVE MODE`);
    const preview = await driveDisconnectPreview(tx);
    if (preview.revision !== revision) return null;
    if (folderAction === "forget") {
      // Keep all file values and all unrelated field configuration.
      await tx.execute(sql`UPDATE entity_fields
        SET file_config_json=file_config_json - 'driveFolderId', updated_at=now()
        WHERE file_config_json ? 'driveFolderId'`);
      await tx.execute(sql`UPDATE page_fields
        SET file_config_json=file_config_json - 'driveFolderId', updated_at=now()
        WHERE file_config_json ? 'driveFolderId'`);
    }
    const [connection] = await tx.update(googleDriveConnectionTable).set({
      refreshTokenEnc: null,
      ...(folderAction === "forget" ? { accountEmail: null, folderId: null, folderName: null } : {}),
      healthState: "unknown", healthReason: null, healthLastCheckedAt: null, healthLastSuccessAt: null,
    }).where(eq(googleDriveConnectionTable.id, 1)).returning();
    if (folderAction === "forget") await tx.delete(googleDriveFoldersTable);
    return connection;
  });
}
