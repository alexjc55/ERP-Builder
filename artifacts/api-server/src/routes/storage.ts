import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  entityRecordsTable,
  entityFieldsTable,
  appSettingsTable,
  type EntityField,
} from "@workspace/db";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/auth";
import {
  getPermissions,
  getUserRoleIds,
  canRecord,
  effectiveScope,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { isRecordOwned } from "./own-scope";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/** True if a stored field value is a file object pointing at `objectPath`. */
function fileValueRefersTo(value: unknown, objectPath: string): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).path === objectPath
  );
}

/**
 * Authorize a private object read by mirroring the records permission boundary:
 * an authenticated user may read an object only if it is referenced by a record
 * they are allowed to view through a non-hidden file field (entity read perm +
 * row scope + field not hidden). This re-applies the same field/row/entity guard
 * the records endpoints enforce, so object serving never leaks bytes a user could
 * not have seen via the record itself. Returns false when no such record exists.
 */
async function canReadObjectPath(req: Request, objectPath: string): Promise<boolean> {
  if (!req.user) return false;
  const candidates = await db
    .select({
      id: entityRecordsTable.id,
      entityId: entityRecordsTable.entityId,
      valuesJson: entityRecordsTable.valuesJson,
    })
    .from(entityRecordsTable)
    .where(sql`${entityRecordsTable.valuesJson}::text LIKE ${"%" + objectPath + "%"}`);
  if (candidates.length === 0) return false;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user.userId;
  const fieldsByEntity = new Map<number, EntityField[]>();

  for (const rec of candidates) {
    if (!canRecord(perms, rec.entityId, "view")) continue;
    let fields = fieldsByEntity.get(rec.entityId);
    if (!fields) {
      fields = await db
        .select()
        .from(entityFieldsTable)
        .where(and(eq(entityFieldsTable.entityId, rec.entityId), eq(entityFieldsTable.isActive, true)));
      fieldsByEntity.set(rec.entityId, fields);
    }
    const values = (rec.valuesJson as Record<string, unknown>) ?? {};
    const holder = fields.find(
      (f) => f.fieldType === "file" && fileValueRefersTo(values[f.fieldKey], objectPath),
    );
    if (!holder) continue;
    if (resolveFieldAccess(holder, perms, roleIds, rec.entityId) === "hidden") continue;
    const { scope, scopeFieldKeys } = effectiveScope(perms, rec.entityId);
    if (scope === "own" && !(await isRecordOwned(rec.entityId, rec, scopeFieldKeys, userId, fields))) continue;
    return true;
  }
  return false;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/branding-logo
 *
 * Serve the platform branding logo. The object path comes from the singleton
 * app_settings row (set by an admin), NOT from user input — so there is no IDOR
 * risk and this is intentionally public (branding is shown in the sidebar and
 * can appear pre-auth). Returns 404 when no logo is configured.
 */
router.get("/storage/branding-logo", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select({ logoObjectPath: appSettingsTable.logoObjectPath })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, 1));

    const objectPath = row?.logoObjectPath;
    if (!objectPath) {
      res.status(404).json({ error: "No logo configured" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Logo not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving branding logo");
    res.status(500).json({ error: "Failed to serve branding logo" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Mirror the records permission boundary: only serve an object the requester
    // could have seen through a record they may view (never trust the URL alone).
    if (!(await canReadObjectPath(req, objectPath))) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
