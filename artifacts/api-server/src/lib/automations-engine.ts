import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import {
  db,
  entityAutomationsTable,
  entityAutomationRunsTable,
  entityRecordsTable,
  entityStatusesTable,
  relationsTable,
  recordLinksTable,
  type EntityAutomation,
  type EntityField,
  type AutomationTrigger,
  type AutomationCondition,
  type AutomationAction,
  type AutomationMapping,
  type InsertAuditLog,
  automationTriggerSchema,
  automationConditionSchema,
  automationActionSchema,
  CONDITION_STATUS_KEY,
} from "@workspace/db";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  loadActiveFields,
  validateValues,
  validateUserRefs,
  checkDependentValues,
  statusBelongsToEntity,
  checkUniqueKeys,
  defaultStatusId,
  isEmpty,
  UNIQUE_KEY_LOCK_NS,
  UniqueKeyError,
} from "../routes/records";
import {
  writeAudit,
  auditStr,
  diffValues,
  AUDIT_STATUS,
  AUDIT_CREATED,
} from "../routes/audit-log";
import {
  emitEvent,
  subscribe,
  EVENT_RECORD_CREATED,
  EVENT_RECORD_UPDATED,
  EVENT_STATUS_CHANGED,
  type EventInput,
} from "./events";
import { isGoogleDriveModuleEnabled } from "./googleDrive";
import { logger } from "./logger";

/**
 * Stage 16 — Automations Engine (runtime).
 *
 * Subscribes to the in-process event bus and, for each entity event, runs the
 * entity's active automations whose trigger matches and whose conditions hold.
 * Actions run AS THE SYSTEM (admin-authoritative): they bypass the initiating
 * user's RBAC and may move a record into any status, overriding the «Процессы»
 * transition graph. A periodic scheduler additionally evaluates date triggers.
 *
 * Cascade safety: automations write records, which emit events, which can fire
 * more automations. An {@link AsyncLocalStorage} context carries a depth counter
 * (hard max) and a per-chain visited set so the same automation never re-fires
 * on the same record within one cascade, and runaway loops are capped.
 *
 * Everything here is best-effort: an automation failure is logged to the run log
 * and never rolls back or breaks the user mutation that triggered it.
 */

const MAX_CASCADE_DEPTH = 8;

interface CascadeContext {
  depth: number;
  /** `${automationId}:${recordId}` keys already run in this cascade. */
  chain: Set<string>;
}

const cascade = new AsyncLocalStorage<CascadeContext>();

type Log = { error: (obj: unknown, msg?: string) => void };

// ---------------------------------------------------------------------------
// Run log (best-effort)
// ---------------------------------------------------------------------------

interface RunLogInput {
  automationId: number;
  entityId: number;
  recordId: number | null;
  status: "success" | "error" | "skipped";
  triggerName?: string | null;
  detail?: Record<string, unknown>;
  dedupeKey?: string | null;
}

async function writeRun(input: RunLogInput, log: Log): Promise<void> {
  try {
    await db.insert(entityAutomationRunsTable).values({
      automationId: input.automationId,
      entityId: input.entityId,
      recordId: input.recordId,
      status: input.status,
      triggerName: input.triggerName ?? null,
      detailJson: input.detail ?? {},
      dedupeKey: input.dedupeKey ?? null,
    });
  } catch (err) {
    log.error({ err, automationId: input.automationId }, "Failed to write automation run log");
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation (type-aware, in-memory)
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function toTime(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Resolve relation/lookup fields' linked values for a set of base records.
 *
 * Relation/lookup fields store no value in `values_json`; their displayed value
 * is the projected `relatedFieldKey` of the linked record(s), reached through
 * `record_links`. This loads, per base record, the array of those projected
 * values (one entry per link, empty entries dropped) so `evalCondition` can
 * evaluate relation conditions with EXISTS-any semantics — exactly matching the
 * records-query relation filter. Only entity-source relations are resolved here;
 * page-source projections (`relatedPageId`) are read from a different store the
 * engine does not evaluate, so they yield an empty array (condition won't match).
 */
async function loadRelationValues(
  entityId: number,
  recordIds: number[],
  fields: EntityField[],
): Promise<Map<number, Record<string, string[]>>> {
  const out = new Map<number, Record<string, string[]>>();
  if (recordIds.length === 0) return out;
  const relFields = fields.filter(
    (f) =>
      (f.fieldType === "relation" || f.fieldType === "lookup") &&
      f.relationConfigJson?.relationId != null &&
      !!f.relationConfigJson?.relatedFieldKey &&
      f.relationConfigJson?.relatedPageId == null,
  );
  if (relFields.length === 0) return out;

  const relationIds = [...new Set(relFields.map((f) => f.relationConfigJson!.relationId as number))];
  const relations = await db.select().from(relationsTable).where(inArray(relationsTable.id, relationIds));
  const relById = new Map(relations.map((r) => [r.id, r]));

  for (const f of relFields) {
    const cfg = f.relationConfigJson!;
    const relation = relById.get(cfg.relationId as number);
    if (!relation) continue;
    const relatedFieldKey = cfg.relatedFieldKey as string;
    // Which link column points at the base record vs. the linked one. Mirrors
    // record-query's direction logic by the base entity's side of the relation.
    const baseIsSource = relation.sourceEntityId === entityId;
    const baseCol = baseIsSource ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
    const linkedCol = baseIsSource ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId;
    const lt = alias(entityRecordsTable, "lt");

    let linkRows: { base: number; v: string | null }[];
    try {
      linkRows = await db
        .select({ base: baseCol, v: sql<string | null>`(${lt.valuesJson} ->> ${relatedFieldKey})` })
        .from(recordLinksTable)
        .innerJoin(lt, eq(lt.id, linkedCol))
        .where(and(eq(recordLinksTable.relationId, relation.id), inArray(baseCol, recordIds)));
    } catch (err) {
      logger.error({ err, relationId: relation.id, fieldKey: f.fieldKey }, "Failed to resolve relation values for automation conditions");
      linkRows = [];
    }

    // Seed an empty array for every record so an unlinked record reads as empty.
    for (const rid of recordIds) {
      const rec = out.get(rid) ?? {};
      if (!(f.fieldKey in rec)) rec[f.fieldKey] = [];
      out.set(rid, rec);
    }
    for (const row of linkRows) {
      if (row.v == null || row.v === "") continue;
      const rec = out.get(row.base) ?? {};
      (rec[f.fieldKey] ??= []).push(String(row.v));
      out.set(row.base, rec);
    }
  }
  return out;
}

/** True when `record` satisfies a single condition. */
function evalCondition(
  cond: AutomationCondition,
  values: Record<string, unknown>,
  statusId: number | null,
  fieldByKey: Map<string, EntityField>,
): boolean {
  const isStatus = cond.fieldKey === CONDITION_STATUS_KEY;
  const actual = isStatus ? statusId : values[cond.fieldKey];
  const field = fieldByKey.get(cond.fieldKey);
  const type = isStatus ? "status" : field?.fieldType ?? "text";

  // Relation / lookup fields have no value in `values_json`: their value is the
  // projected `relatedFieldKey` of the linked record(s), pre-resolved by
  // `loadRelationValues` into `values[fieldKey]` as a string[] (one entry per
  // link). Matching uses EXISTS-any semantics, identical to the records query's
  // relation filter, so a condition holds when ANY linked value matches.
  if (type === "relation" || type === "lookup") {
    const arr = Array.isArray(actual) ? (actual as unknown[]).map((x) => String(x)).filter((s) => s !== "") : [];
    switch (cond.operator) {
      case "empty":
        return arr.length === 0;
      case "notEmpty":
        return arr.length > 0;
      case "eq":
        return arr.includes(String(cond.value ?? ""));
      case "neq":
        return !arr.includes(String(cond.value ?? ""));
      case "contains": {
        const needle = String(cond.value ?? "").toLowerCase();
        return arr.some((v) => v.toLowerCase().includes(needle));
      }
      default:
        return false; // ordering operators are not meaningful for relations
    }
  }

  switch (cond.operator) {
    case "empty":
      return isEmpty(actual);
    case "notEmpty":
      return !isEmpty(actual);
    case "eq":
    case "neq": {
      let equal: boolean;
      if (isStatus || type === "number") {
        equal = toNumber(actual) === toNumber(cond.value);
      } else {
        equal = String(actual ?? "") === String(cond.value ?? "");
      }
      return cond.operator === "eq" ? equal : !equal;
    }
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(cond.value ?? "").toLowerCase());
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const useTime = type === "date" || type === "datetime";
      const a = useTime ? toTime(actual) : toNumber(actual);
      const b = useTime ? toTime(cond.value) : toNumber(cond.value);
      if (a == null || b == null) return false;
      if (cond.operator === "gt") return a > b;
      if (cond.operator === "lt") return a < b;
      if (cond.operator === "gte") return a >= b;
      return a <= b;
    }
    default:
      return false;
  }
}

function evalConditions(
  conditions: AutomationCondition[],
  values: Record<string, unknown>,
  statusId: number | null,
  fieldByKey: Map<string, EntityField>,
  conjunction: "and" | "or" = "and",
): boolean {
  if (conditions.length === 0) return true;
  const test = (c: AutomationCondition) => evalCondition(c, values, statusId, fieldByKey);
  return conjunction === "or" ? conditions.some(test) : conditions.every(test);
}

// ---------------------------------------------------------------------------
// System record writes (bypass RBAC + workflow; still type-validated)
// ---------------------------------------------------------------------------

/**
 * Create a record as the system. Returns the new record id, or null on failure
 * (logged). Emits EVENT_RECORD_CREATED so downstream automations can cascade.
 */
export async function systemCreateRecord(
  entityId: number,
  partialValues: Record<string, unknown>,
  statusIdInput: number | null | undefined,
  actorUserId: number | null,
  log: Log,
): Promise<number | null> {
  try {
    const fields = await loadActiveFields(entityId);
    const activeKeys = new Set(fields.map((f) => f.fieldKey));
    const incoming: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(partialValues)) {
      if (activeKeys.has(k)) incoming[k] = v;
    }
    const gdrive = await isGoogleDriveModuleEnabled();
    const result = validateValues(fields, incoming, gdrive);
    if ("error" in result) {
      log.error({ entityId, error: result.error }, "Automation create_record validation failed");
      return null;
    }
    const userRefErr = await validateUserRefs(fields, result.values);
    if (userRefErr) {
      log.error({ entityId, error: userRefErr }, "Automation create_record user-ref invalid");
      return null;
    }
    const depErr = await checkDependentValues(entityId, fields, result.values);
    if (depErr) {
      log.error({ entityId, error: depErr }, "Automation create_record dependent-value invalid");
      return null;
    }

    let statusId: number | null;
    if (statusIdInput === undefined) {
      statusId = await defaultStatusId(entityId);
    } else if (statusIdInput === null) {
      statusId = null;
    } else if (await statusBelongsToEntity(statusIdInput, entityId)) {
      statusId = statusIdInput;
    } else {
      log.error({ entityId, statusIdInput }, "Automation create_record status not in entity");
      return null;
    }

    const keyFields = fields.filter((f) => f.isKey);
    const record = await db.transaction(async (tx) => {
      if (keyFields.length > 0) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${entityId})`);
        const dup = await checkUniqueKeys(tx, entityId, keyFields, result.values);
        if (dup) throw new UniqueKeyError(dup);
      }
      const [rec] = await tx
        .insert(entityRecordsTable)
        .values({ entityId, valuesJson: result.values, statusId, statusChangedAt: new Date() })
        .returning();
      if (!rec) throw new Error("Failed to create record");
      return rec;
    });

    const entries: InsertAuditLog[] = [];
    for (const f of fields) {
      const v = auditStr(result.values[f.fieldKey]);
      if (v !== null) entries.push({ entityId, recordId: record.id, fieldKey: f.fieldKey, oldValue: null, newValue: v, userId: actorUserId });
    }
    if (statusId != null) entries.push({ entityId, recordId: record.id, fieldKey: AUDIT_STATUS, oldValue: null, newValue: String(statusId), userId: actorUserId });
    if (entries.length === 0) entries.push({ entityId, recordId: record.id, fieldKey: AUDIT_CREATED, oldValue: null, newValue: null, userId: actorUserId });
    await writeAudit(entries, logger);

    await emitEvent(
      { eventName: EVENT_RECORD_CREATED, entityId, recordId: record.id, payload: { actorUserId, statusId: record.statusId } },
      logger,
    );
    return record.id;
  } catch (err) {
    if (err instanceof UniqueKeyError) {
      log.error({ entityId, error: err.message }, "Automation create_record duplicate key");
      return null;
    }
    log.error({ err, entityId }, "Automation create_record failed");
    return null;
  }
}

/**
 * Update a record as the system. `partialValues` are merged over the stored
 * values; `statusId` (when provided) is set DIRECTLY, overriding «Процессы».
 * Emits EVENT_RECORD_UPDATED / EVENT_STATUS_CHANGED so cascades flow.
 */
export async function systemUpdateRecord(
  recordId: number,
  partialValues: Record<string, unknown> | undefined,
  statusIdInput: number | null | undefined,
  actorUserId: number | null,
  log: Log,
): Promise<boolean> {
  try {
    const [existing] = await db
      .select()
      .from(entityRecordsTable)
      .where(eq(entityRecordsTable.id, recordId))
      .limit(1);
    if (!existing) return false;
    const entityId = existing.entityId;
    const fields = await loadActiveFields(entityId);
    const existingValues = (existing.valuesJson as Record<string, unknown>) ?? {};

    const update: { valuesJson?: Record<string, unknown>; statusId?: number | null; statusChangedAt?: Date; archiveExempt?: boolean } = {};

    const hasValues = partialValues !== undefined && Object.keys(partialValues).length > 0;
    if (hasValues) {
      const candidate: Record<string, unknown> = {};
      for (const f of fields) {
        candidate[f.fieldKey] = f.fieldKey in partialValues! ? partialValues![f.fieldKey] : existingValues[f.fieldKey];
      }
      const gdrive = await isGoogleDriveModuleEnabled();
      const result = validateValues(fields, candidate, gdrive, existingValues);
      if ("error" in result) {
        log.error({ recordId, error: result.error }, "Automation set_field validation failed");
        return false;
      }
      const userRefErr = await validateUserRefs(fields, result.values);
      if (userRefErr) {
        log.error({ recordId, error: userRefErr }, "Automation set_field user-ref invalid");
        return false;
      }
      const depErr = await checkDependentValues(entityId, fields, result.values, recordId);
      if (depErr) {
        log.error({ recordId, error: depErr }, "Automation set_field dependent-value invalid");
        return false;
      }
      update.valuesJson = result.values;
    }

    const statusChanging = statusIdInput !== undefined && (statusIdInput ?? null) !== (existing.statusId ?? null);
    if (statusIdInput !== undefined) {
      if (statusIdInput === null) {
        update.statusId = null;
      } else if (await statusBelongsToEntity(statusIdInput, entityId)) {
        update.statusId = statusIdInput;
      } else {
        log.error({ recordId, statusIdInput }, "Automation change_status not in entity");
        return false;
      }
    }
    if (statusChanging) {
      update.statusChangedAt = new Date();
      update.archiveExempt = false;
    }

    if (Object.keys(update).length === 0) return false;

    const keyFields = fields.filter((f) => f.isKey);
    const record = await db.transaction(async (tx) => {
      if (keyFields.length > 0 && update.valuesJson !== undefined) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${entityId})`);
        const dup = await checkUniqueKeys(tx, entityId, keyFields, update.valuesJson, recordId);
        if (dup) throw new UniqueKeyError(dup);
      }
      const [rec] = await tx.update(entityRecordsTable).set(update).where(eq(entityRecordsTable.id, recordId)).returning();
      return rec;
    });
    if (!record) return false;

    const entries: InsertAuditLog[] = [];
    let changedFields: string[] = [];
    if (update.valuesJson !== undefined) {
      const after = record.valuesJson as Record<string, unknown>;
      for (const c of diffValues(existingValues, after, fields.map((f) => f.fieldKey))) {
        entries.push({ entityId, recordId: record.id, ...c, userId: actorUserId });
        changedFields.push(c.fieldKey);
      }
    }
    if (statusChanging) {
      entries.push({
        entityId,
        recordId: record.id,
        fieldKey: AUDIT_STATUS,
        oldValue: existing.statusId != null ? String(existing.statusId) : null,
        newValue: record.statusId != null ? String(record.statusId) : null,
        userId: actorUserId,
      });
    }
    await writeAudit(entries, logger);

    const events: EventInput[] = [
      { eventName: EVENT_RECORD_UPDATED, entityId, recordId: record.id, payload: { actorUserId, changedFields } },
    ];
    if (statusChanging) {
      events.push({
        eventName: EVENT_STATUS_CHANGED,
        entityId,
        recordId: record.id,
        payload: { actorUserId, from: existing.statusId ?? null, to: record.statusId ?? null },
      });
    }
    await emitEvent(events, logger);
    return true;
  } catch (err) {
    if (err instanceof UniqueKeyError) {
      log.error({ recordId, error: err.message }, "Automation update duplicate key");
      return false;
    }
    log.error({ err, recordId }, "Automation update failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook (SSRF-guarded)
// ---------------------------------------------------------------------------

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === "::1" || lc === "::") return true;
    if (lc.startsWith("fe80") || lc.startsWith("fc") || lc.startsWith("fd")) return true;
    // IPv4-mapped
    const m = lc.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]!);
    return false;
  }
  return false;
}

async function sendWebhook(url: string, payload: unknown, log: Log): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.error({ url }, "Automation webhook: invalid URL");
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    log.error({ url }, "Automation webhook: only http/https allowed");
    return false;
  }
  try {
    const addrs = await lookup(parsed.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
      log.error({ host: parsed.hostname }, "Automation webhook: host resolves to a private/loopback address");
      return false;
    }
  } catch (err) {
    log.error({ err, host: parsed.hostname }, "Automation webhook: DNS lookup failed");
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "error",
    });
    return res.ok;
  } catch (err) {
    log.error({ err, url }, "Automation webhook: request failed");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

function buildMappedValues(
  mapping: AutomationMapping[],
  sourceValues: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of mapping) {
    if (m.sourceType === "field") {
      if (m.sourceFieldKey && m.sourceFieldKey in sourceValues) out[m.targetFieldKey] = sourceValues[m.sourceFieldKey];
    } else {
      out[m.targetFieldKey] = m.value;
    }
  }
  return out;
}

/** Execute one automation's actions in order. Returns a per-action summary. */
async function runActions(
  actions: AutomationAction[],
  ctx: { entityId: number; recordId: number; values: Record<string, unknown>; statusId: number | null; actorUserId: number | null },
  log: Log,
): Promise<{ type: string; ok: boolean }[]> {
  const summary: { type: string; ok: boolean }[] = [];
  for (const action of actions) {
    let ok = false;
    switch (action.type) {
      case "set_field":
        ok = await systemUpdateRecord(ctx.recordId, { [action.fieldKey]: action.value }, undefined, ctx.actorUserId, log);
        break;
      case "change_status":
        ok = await systemUpdateRecord(ctx.recordId, undefined, action.statusId, ctx.actorUserId, log);
        break;
      case "create_record": {
        const values = buildMappedValues(action.mapping ?? [], ctx.values);
        const id = await systemCreateRecord(action.targetEntityId, values, action.statusId, ctx.actorUserId, log);
        ok = id != null;
        break;
      }
      case "update_records_where": {
        const targetFields = await loadActiveFields(action.targetEntityId);
        const fieldByKey = new Map(targetFields.map((f) => [f.fieldKey, f]));
        const rows = await db
          .select()
          .from(entityRecordsTable)
          .where(and(eq(entityRecordsTable.entityId, action.targetEntityId), sql`${entityRecordsTable.archivedAt} is null`));
        const mappedValues = buildMappedValues(action.mapping ?? [], ctx.values);
        const relValues = await loadRelationValues(action.targetEntityId, rows.map((r) => r.id), targetFields);
        let allOk = true;
        for (const row of rows) {
          const rv = { ...((row.valuesJson as Record<string, unknown>) ?? {}), ...(relValues.get(row.id) ?? {}) };
          if (!evalConditions(action.match ?? [], rv, row.statusId ?? null, fieldByKey)) continue;
          const updated = await systemUpdateRecord(row.id, mappedValues, undefined, ctx.actorUserId, log);
          if (!updated) allOk = false;
        }
        ok = allOk;
        break;
      }
      case "webhook": {
        const payload = action.includeRecord
          ? { entityId: ctx.entityId, recordId: ctx.recordId, values: ctx.values, statusId: ctx.statusId }
          : { entityId: ctx.entityId, recordId: ctx.recordId };
        ok = await sendWebhook(action.url, payload, log);
        break;
      }
    }
    summary.push({ type: action.type, ok });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Trigger matching + dispatch
// ---------------------------------------------------------------------------

function safeTrigger(raw: unknown): AutomationTrigger | null {
  const parsed = automationTriggerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function safeConditions(raw: unknown): AutomationCondition[] {
  const parsed = automationConditionSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function safeActions(raw: unknown): AutomationAction[] {
  const parsed = automationActionSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

type EventKind = "record.created" | "record.updated" | "status.changed";

function triggerMatchesEvent(
  trigger: AutomationTrigger,
  kind: EventKind,
  payload: Record<string, unknown>,
): boolean {
  switch (trigger.type) {
    case "record_created":
      return kind === "record.created";
    case "record_updated":
      return kind === "record.updated";
    case "field_changed": {
      if (kind !== "record.updated") return false;
      const changed = Array.isArray(payload.changedFields) ? (payload.changedFields as string[]) : [];
      return changed.includes(trigger.fieldKey);
    }
    case "status_changed": {
      if (kind !== "status.changed") return false;
      const from = (payload.from ?? null) as number | null;
      const to = (payload.to ?? null) as number | null;
      if (trigger.fromStatusId != null && trigger.fromStatusId !== from) return false;
      if (trigger.toStatusId != null && trigger.toStatusId !== to) return false;
      return true;
    }
    case "date_reached":
      return false; // scheduler-only
  }
}

async function dispatchEvent(kind: EventKind, ev: { entityId: number | null; recordId: number | null; payloadJson: unknown }): Promise<void> {
  const log = logger;
  if (ev.entityId == null || ev.recordId == null) return;
  const entityId = ev.entityId;
  const recordId = ev.recordId;
  const payload = (ev.payloadJson as Record<string, unknown>) ?? {};
  const actorUserId = typeof payload.actorUserId === "number" ? payload.actorUserId : null;

  let automations: EntityAutomation[];
  try {
    automations = await db
      .select()
      .from(entityAutomationsTable)
      .where(and(eq(entityAutomationsTable.entityId, entityId), eq(entityAutomationsTable.isActive, true)))
      .orderBy(asc(entityAutomationsTable.sortOrder));
  } catch (err) {
    log.error({ err, entityId }, "Failed to load automations");
    return;
  }
  if (automations.length === 0) return;

  for (const automation of automations) {
    const trigger = safeTrigger(automation.triggerJson);
    if (!trigger || !triggerMatchesEvent(trigger, kind, payload)) continue;
    await runOne(automation, trigger, entityId, recordId, actorUserId, kind, null);
  }
}

/**
 * Run a single automation against a record, applying cascade guards. Loads the
 * record fresh, evaluates conditions, then executes actions inside a depth-
 * incremented context.
 */
async function runOne(
  automation: EntityAutomation,
  trigger: AutomationTrigger,
  entityId: number,
  recordId: number,
  actorUserId: number | null,
  triggerName: string,
  dedupeKey: string | null,
): Promise<void> {
  const log = logger;
  const parent = cascade.getStore();
  const depth = parent ? parent.depth : 0;
  const chain = parent ? parent.chain : new Set<string>();
  const key = `${automation.id}:${recordId}`;

  if (chain.has(key)) return; // already fired on this record in this cascade
  if (depth >= MAX_CASCADE_DEPTH) {
    await writeRun({ automationId: automation.id, entityId, recordId, status: "skipped", triggerName, detail: { reason: "max cascade depth" }, dedupeKey }, log);
    return;
  }

  try {
    const [record] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId)).limit(1);
    if (!record) return;
    const fields = await loadActiveFields(entityId);
    const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));
    const relValues = await loadRelationValues(entityId, [recordId], fields);
    const values = { ...((record.valuesJson as Record<string, unknown>) ?? {}), ...(relValues.get(recordId) ?? {}) };

    const conditions = safeConditions(automation.conditionsJson);
    const conjunction = automation.conditionConjunction === "or" ? "or" : "and";
    if (!evalConditions(conditions, values, record.statusId ?? null, fieldByKey, conjunction)) {
      await writeRun({ automationId: automation.id, entityId, recordId, status: "skipped", triggerName, detail: { reason: "conditions not met" }, dedupeKey }, log);
      return;
    }

    const actions = safeActions(automation.actionsJson);
    const nextChain = new Set(chain);
    nextChain.add(key);
    const summary = await cascade.run({ depth: depth + 1, chain: nextChain }, () =>
      runActions(actions, { entityId, recordId, values, statusId: record.statusId ?? null, actorUserId }, log),
    );
    const allOk = summary.every((s) => s.ok);
    await writeRun({
      automationId: automation.id,
      entityId,
      recordId,
      status: allOk ? "success" : "error",
      triggerName,
      detail: { actions: summary },
      dedupeKey,
    }, log);
  } catch (err) {
    log.error({ err, automationId: automation.id, recordId }, "Automation run failed");
    await writeRun({ automationId: automation.id, entityId, recordId, status: "error", triggerName, detail: { error: String(err) }, dedupeKey }, log);
  }
}

// ---------------------------------------------------------------------------
// Date scheduler
// ---------------------------------------------------------------------------

const SCHEDULER_INTERVAL_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;

/** One scheduler sweep: fire due date_reached automations exactly once each. */
export async function runDateSweep(now: Date = new Date()): Promise<void> {
  const log = logger;
  let automations: EntityAutomation[];
  try {
    automations = await db
      .select()
      .from(entityAutomationsTable)
      .where(eq(entityAutomationsTable.isActive, true))
      .orderBy(asc(entityAutomationsTable.sortOrder));
  } catch (err) {
    log.error({ err }, "Date sweep: failed to load automations");
    return;
  }

  for (const automation of automations) {
    const trigger = safeTrigger(automation.triggerJson);
    if (!trigger || trigger.type !== "date_reached") continue;
    const offsetDays = trigger.offsetDays ?? 0;

    let rows: (typeof entityRecordsTable.$inferSelect)[];
    try {
      rows = await db
        .select()
        .from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.entityId, automation.entityId), sql`${entityRecordsTable.archivedAt} is null`));
    } catch (err) {
      log.error({ err, automationId: automation.id }, "Date sweep: failed to load records");
      continue;
    }

    for (const row of rows) {
      const values = (row.valuesJson as Record<string, unknown>) ?? {};
      const raw = values[trigger.fieldKey];
      const baseTime = toTime(raw);
      if (baseTime == null) continue;
      const dueTime = baseTime + offsetDays * 86_400_000;
      if (dueTime > now.getTime()) continue;

      // Idempotency: claim a run row keyed by the due instant. If the row already
      // exists (conflict → no row returned), this (automation, record, due) has
      // already fired and we skip it.
      const dedupeKey = `date:${trigger.fieldKey}:${new Date(baseTime).toISOString()}:${offsetDays}`;
      let claimed = false;
      try {
        const inserted = await db
          .insert(entityAutomationRunsTable)
          .values({
            automationId: automation.id,
            entityId: automation.entityId,
            recordId: row.id,
            status: "skipped",
            triggerName: "date_reached",
            detailJson: { claimed: true },
            dedupeKey,
          })
          .onConflictDoNothing()
          .returning({ id: entityAutomationRunsTable.id });
        claimed = inserted.length > 0;
      } catch (err) {
        log.error({ err, automationId: automation.id, recordId: row.id }, "Date sweep: claim failed");
        continue;
      }
      if (!claimed) continue;

      // Re-evaluate conditions and run actions. The claim row already exists as
      // the idempotency marker; record the outcome on a fresh run row.
      await runOne(automation, trigger, automation.entityId, row.id, null, "date_reached", null);
    }
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Schedule an automation dispatch OFF the user mutation path. The event-bus
 * subscriber must return synchronously (void, not a promise) so `emitEvent` does
 * not await action execution — automations are best-effort and must never add
 * latency to (or fail) the request that triggered them. `setImmediate` runs the
 * work on the next tick; Node's AsyncLocalStorage propagates the cascade context
 * across it, so depth/chain guards still apply when a cascade re-emits events.
 */
function scheduleDispatch(kind: EventKind, ev: { entityId: number | null; recordId: number | null; payloadJson: unknown }): void {
  setImmediate(() => {
    dispatchEvent(kind, ev).catch((err) => logger.error({ err, kind }, "Automation dispatch failed"));
  });
}

/** Subscribe to the event bus and start the date scheduler. Idempotent. */
export function initAutomations(): void {
  if (initialized) return;
  initialized = true;

  subscribe(EVENT_RECORD_CREATED, (ev) => scheduleDispatch("record.created", ev));
  subscribe(EVENT_RECORD_UPDATED, (ev) => scheduleDispatch("record.updated", ev));
  subscribe(EVENT_STATUS_CHANGED, (ev) => scheduleDispatch("status.changed", ev));

  schedulerTimer = setInterval(() => {
    runDateSweep().catch((err) => logger.error({ err }, "Date sweep crashed"));
  }, SCHEDULER_INTERVAL_MS);
  // Don't keep the process alive solely for the sweep.
  schedulerTimer.unref?.();
}

export function stopAutomations(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  initialized = false;
}
