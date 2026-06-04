import { Router, type IRouter } from "express";
import { db, entityRecordsTable, entityFieldsTable, entityStatusesTable, entitiesTable } from "@workspace/db";
import { eq, asc, desc, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireRecordParam, assertRecord } from "../middlewares/permissions";
import {
  ListEntityRecordsParams,
  CreateEntityRecordParams,
  CreateEntityRecordBody,
  GetRecordParams,
  UpdateRecordParams,
  UpdateRecordBody,
  DeleteRecordParams,
  QueryEntityRecordsParams,
  QueryEntityRecordsBody,
} from "@workspace/api-zod";
import type { EntityField } from "@workspace/db";
import { buildRecordQuery, type RecordQuerySpec } from "./record-query";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9().\s-]{3,}$/;

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  return Boolean(entity);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Validate a record's values against the entity's active field definitions.
 * Returns the cleaned values object, or an error message string.
 */
function validateValues(fields: EntityField[], values: Record<string, unknown>): { values: Record<string, unknown> } | { error: string } {
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));

  // Reject unknown keys (metadata-driven integrity: no junk columns).
  for (const key of Object.keys(values)) {
    if (!fieldByKey.has(key)) {
      return { error: `Unknown field: ${key}` };
    }
  }

  const cleaned: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.fieldKey];

    if (isEmpty(raw)) {
      if (field.isRequired) {
        return { error: `Field "${field.fieldKey}" is required` };
      }
      continue;
    }

    switch (field.fieldType) {
      case "text":
      case "textarea": {
        if (typeof raw !== "string") return { error: `Field "${field.fieldKey}" must be a string` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "email": {
        if (typeof raw !== "string" || !EMAIL_RE.test(raw)) return { error: `Field "${field.fieldKey}" must be a valid email` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "url": {
        if (typeof raw !== "string") return { error: `Field "${field.fieldKey}" must be a valid URL` };
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          return { error: `Field "${field.fieldKey}" must be a valid URL` };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { error: `Field "${field.fieldKey}" must be an http or https URL` };
        }
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "phone": {
        if (typeof raw !== "string" || !PHONE_RE.test(raw)) return { error: `Field "${field.fieldKey}" must be a valid phone number` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "number": {
        if (typeof raw !== "number" || !Number.isFinite(raw)) return { error: `Field "${field.fieldKey}" must be a number` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "boolean": {
        if (typeof raw !== "boolean") return { error: `Field "${field.fieldKey}" must be a boolean` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "date": {
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return { error: `Field "${field.fieldKey}" must be a valid date` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "datetime": {
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return { error: `Field "${field.fieldKey}" must be a valid datetime` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "select": {
        if (typeof raw !== "string") return { error: `Field "${field.fieldKey}" must be a string` };
        const options = Array.isArray(field.optionsJson) ? (field.optionsJson as unknown[]) : [];
        if (!options.includes(raw)) return { error: `Field "${field.fieldKey}" must be one of the allowed options` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      default: {
        // Unknown field type: store as-is to avoid blocking on future types.
        cleaned[field.fieldKey] = raw;
      }
    }
  }

  return { values: cleaned };
}

async function loadActiveFields(entityId: number): Promise<EntityField[]> {
  return db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)))
    .orderBy(asc(entityFieldsTable.sortOrder));
}

/** Returns true if the status belongs to the given entity. */
async function statusBelongsToEntity(statusId: number, entityId: number): Promise<boolean> {
  const [status] = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.id, statusId), eq(entityStatusesTable.entityId, entityId)))
    .limit(1);
  return Boolean(status);
}

async function defaultStatusId(entityId: number): Promise<number | null> {
  const [status] = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.isDefault, true)))
    .limit(1);
  return status ? status.id : null;
}

router.get("/entities/:entityId/records", requireAuth, requireRecordParam("view"), async (req, res): Promise<void> => {
  const params = ListEntityRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const records = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.entityId, params.data.entityId))
    .orderBy(desc(entityRecordsTable.createdAt));
  res.json(records);
});

router.post("/entities/:entityId/records/query", requireAuth, requireRecordParam("view"), async (req, res): Promise<void> => {
  const params = QueryEntityRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = QueryEntityRecordsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId } = params.data;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const fields = await loadActiveFields(entityId);
  const built = buildRecordQuery(fields, body.data as RecordQuerySpec);
  if ("error" in built) {
    res.status(400).json({ error: built.error });
    return;
  }

  const entityWhere = eq(entityRecordsTable.entityId, entityId);
  const where = built.where ? and(entityWhere, built.where) : entityWhere;

  const { page, pageSize } = body.data;
  const offset = (page - 1) * pageSize;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityRecordsTable)
    .where(where);

  const data = await db
    .select()
    .from(entityRecordsTable)
    .where(where)
    .orderBy(...built.orderBy)
    .limit(pageSize)
    .offset(offset);

  res.json({ data, total: countRow?.count ?? 0 });
});

router.post("/entities/:entityId/records", requireAuth, requireRecordParam("create"), async (req, res): Promise<void> => {
  const params = CreateEntityRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateEntityRecordBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId } = params.data;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const fields = await loadActiveFields(entityId);
  const result = validateValues(fields, body.data.valuesJson);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  let statusId: number | null;
  if (body.data.statusId === undefined) {
    statusId = await defaultStatusId(entityId);
  } else if (body.data.statusId === null) {
    statusId = null;
  } else {
    if (!(await statusBelongsToEntity(body.data.statusId, entityId))) {
      res.status(400).json({ error: "Status does not belong to this entity" });
      return;
    }
    statusId = body.data.statusId;
  }

  const [record] = await db
    .insert(entityRecordsTable)
    .values({ entityId, valuesJson: result.values, statusId })
    .returning();
  res.status(201).json(record);
});

router.get("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, record.entityId, "view"))) return;
  res.json(record);
});

router.put("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRecordBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, existing.entityId, "update"))) return;

  const hasValues = body.data.valuesJson !== undefined;
  const hasStatus = body.data.statusId !== undefined;
  if (!hasValues && !hasStatus) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const update: { valuesJson?: Record<string, unknown>; statusId?: number | null } = {};

  if (hasValues) {
    const fields = await loadActiveFields(existing.entityId);
    const result = validateValues(fields, body.data.valuesJson as Record<string, unknown>);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    update.valuesJson = result.values;
  }

  if (hasStatus) {
    if (body.data.statusId === null) {
      update.statusId = null;
    } else {
      if (!(await statusBelongsToEntity(body.data.statusId as number, existing.entityId))) {
        res.status(400).json({ error: "Status does not belong to this entity" });
        return;
      }
      update.statusId = body.data.statusId as number;
    }
  }

  const [record] = await db
    .update(entityRecordsTable)
    .set(update)
    .where(eq(entityRecordsTable.id, params.data.id))
    .returning();
  res.json(record);
});

router.delete("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, existing.entityId, "delete"))) return;

  await db.delete(entityRecordsTable).where(eq(entityRecordsTable.id, params.data.id));
  res.json({ success: true });
});

export default router;
