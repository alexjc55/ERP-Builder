import { randomBytes } from "crypto";
import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  inboundIntegrationsTable,
  inboundMappingVersionsTable,
  inboundDeliveriesTable,
  inboundDeliveryStepLogsTable,
  inboundExternalObjectMappingsTable,
  usersTable,
  rolesTable,
  userRolesTable,
  entityRecordsTable,
  entityFieldsTable,
  entityStatusesTable,
  pageFieldsTable,
  pageRecordValuesTable,
  relationsTable,
  recordLinksTable,
  auditLogTable,
  modulesTable,
  type InsertAuditLog,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  requireAdmin,
  getPermissions,
  getUserRoleIds,
  effectiveRecordPerm,
  effectiveScopeFor,
  isPrivilegedRole,
  mostPermissiveFieldPerm,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { fieldAccessContext, validateValues, validateUserRefs, checkDependentValues, checkValidationRules, checkUniqueKeys, checkImmutableFields, type DbExecutor } from "./records";
import { isRecordOwned } from "./own-scope";
import { validatePageValues } from "./page-fields";
import { validateInboundMapping, resolveInboundValue, readInboundPath, type InboundMatch, type InboundStep } from "../lib/inbound-mapping";
import { INBOUND_SECRET_PREFIX, classifyInboundDuplicate, hashInboundSecret, parseInboundBearer } from "../lib/inbound-auth";
import { AUDIT_CREATED, auditStr, diffValues } from "./audit-log";
import {
  emitEvent,
  EVENT_PAGE_FIELD_SAVED,
  EVENT_RECORD_CREATED,
  EVENT_RECORD_UPDATED,
  EVENT_USER_CREATED,
  type EventInput,
} from "../lib/events";

const adminRouter: IRouter = Router();
export const inboundWebhookRouter: IRouter = Router();
export const INBOUND_INTEGRATIONS_MODULE_KEY = "inbound_integrations";
const makeSecret = () => {
  const plainSecret = INBOUND_SECRET_PREFIX + randomBytes(32).toString("base64url");
  return { plainSecret, tokenHash: hashInboundSecret(plainSecret), tokenPrefix: `${plainSecret.slice(0, 12)}…` };
};
const int = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const errorMessage = (err: unknown) => err instanceof Error ? err.message.slice(0, 1000) : "Inbound processing failed";

async function validateRoleIds(roleIds: number[]): Promise<string | null> {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) return "At least one role is required";
  const rows = await db.select({ id: rolesTable.id }).from(rolesTable);
  const found = new Set(rows.map((r) => r.id));
  return unique.find((id) => !found.has(id)) == null ? null : "Role not found";
}

adminRouter.get("/inbound-integrations", requireAuth, requireAdmin("inboundIntegrations"), async (_req, res) => {
  const rows = await db.select().from(inboundIntegrationsTable).orderBy(desc(inboundIntegrationsTable.createdAt));
  res.json(rows);
});

adminRouter.post("/inbound-integrations", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const roleIds: number[] = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(Number).filter((n: number) => Number.isInteger(n)) : [];
  if (!name || roleIds.length === 0) { res.status(400).json({ error: "Name and roleIds are required" }); return; }
  const roleError = await validateRoleIds(roleIds);
  if (roleError) { res.status(400).json({ error: roleError }); return; }
  const secret = makeSecret();
  const created = await db.transaction(async (tx) => {
    const [user] = await tx.insert(usersTable).values({
      email: `inbound-${randomBytes(8).toString("hex")}@integrations.local`,
      passwordHash: null,
      firstName: name,
      lastName: "(Inbound integration)",
      roleId: roleIds[0]!,
    }).returning({ id: usersTable.id });
    if (!user) throw new Error("Failed to create backing user");
    for (const roleId of [...new Set(roleIds.slice(1))]) await tx.insert(userRolesTable).values({ userId: user.id, roleId }).onConflictDoNothing();
    const [integration] = await tx.insert(inboundIntegrationsTable).values({
      name, userId: user.id, roleId: roleIds[0]!, tokenHash: secret.tokenHash, tokenPrefix: secret.tokenPrefix,
      maxBodyBytes: Math.min(5_000_000, Math.max(1024, int(req.body?.maxBodyBytes) ?? 1_048_576)),
    }).returning();
    return integration!;
  });
  res.status(201).json({ ...created, plainSecret: secret.plainSecret });
});

adminRouter.get("/inbound-integrations/errors", requireAuth, requireAdmin("inboundIntegrations"), async (req, res) => {
  const limit = Math.min(100, Math.max(1, int(req.query.limit) ?? 25));
  const rows = await db.select().from(inboundDeliveriesTable)
    .where(eq(inboundDeliveriesTable.status, "failed")).orderBy(desc(inboundDeliveriesTable.receivedAt)).limit(limit);
  res.json({ unresolved: rows.length, items: rows });
});

adminRouter.get("/inbound-integrations/:id", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [integration] = await db.select().from(inboundIntegrationsTable).where(eq(inboundIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Integration not found" }); return; }
  const [versions, deliveries, roleRows] = await Promise.all([
    db.select().from(inboundMappingVersionsTable).where(eq(inboundMappingVersionsTable.integrationId, id)).orderBy(desc(inboundMappingVersionsTable.version)),
    db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.integrationId, id)).orderBy(desc(inboundDeliveriesTable.receivedAt)).limit(100),
    db.select({ roleId: userRolesTable.roleId }).from(userRolesTable).where(eq(userRolesTable.userId, integration.userId)),
  ]);
  res.json({ ...integration, roleIds: [integration.roleId, ...roleRows.map((r) => r.roleId)], versions, deliveries });
});

adminRouter.put("/inbound-integrations/:id", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(inboundIntegrationsTable).where(eq(inboundIntegrationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Integration not found" }); return; }
  const updates: Record<string, unknown> = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  if (req.body?.maxBodyBytes != null) updates.maxBodyBytes = Math.min(5_000_000, Math.max(1024, int(req.body.maxBodyBytes) ?? 1_048_576));
  const roleIds: number[] | null = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(Number).filter((n: number) => Number.isInteger(n)) : null;
  if (roleIds) {
    const roleError = await validateRoleIds(roleIds);
    if (roleError) { res.status(400).json({ error: roleError }); return; }
    updates.roleId = roleIds[0]!;
  }
  const updated = await db.transaction(async (tx) => {
    if (roleIds) {
      await tx.update(usersTable).set({ roleId: roleIds[0]! }).where(eq(usersTable.id, existing.userId));
      await tx.delete(userRolesTable).where(eq(userRolesTable.userId, existing.userId));
      for (const roleId of [...new Set(roleIds.slice(1))]) await tx.insert(userRolesTable).values({ userId: existing.userId, roleId }).onConflictDoNothing();
    }
    if (updates.name) await tx.update(usersTable).set({ firstName: String(updates.name) }).where(eq(usersTable.id, existing.userId));
    if (updates.isActive != null) await tx.update(usersTable).set({ isActive: Boolean(updates.isActive) }).where(eq(usersTable.id, existing.userId));
    const [row] = await tx.update(inboundIntegrationsTable).set(updates).where(eq(inboundIntegrationsTable.id, id)).returning();
    return row;
  });
  res.json(updated);
});

adminRouter.delete("/inbound-integrations/:id", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(inboundIntegrationsTable).where(eq(inboundIntegrationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Integration not found" }); return; }
  await db.transaction(async (tx) => {
    await tx.update(inboundIntegrationsTable).set({ isActive: false }).where(eq(inboundIntegrationsTable.id, id));
    await tx.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, existing.userId));
  });
  res.json({ success: true });
});

adminRouter.post("/inbound-integrations/:id/regenerate-secret", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id); if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const secret = makeSecret();
  const [row] = await db.update(inboundIntegrationsTable).set({ tokenHash: secret.tokenHash, tokenPrefix: secret.tokenPrefix }).where(eq(inboundIntegrationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Integration not found" }); return; }
  res.json({ ...row, plainSecret: secret.plainSecret });
});

adminRouter.post("/inbound-integrations/:id/mappings", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const integrationId = int(req.params.id); if (!integrationId) { res.status(400).json({ error: "Invalid id" }); return; }
  const checked = validateInboundMapping(req.body?.mapping ?? req.body);
  if (!checked.ok) { res.status(400).json({ error: "Invalid mapping", details: checked.errors }); return; }
  const [latest] = await db.select({ version: inboundMappingVersionsTable.version }).from(inboundMappingVersionsTable)
    .where(eq(inboundMappingVersionsTable.integrationId, integrationId)).orderBy(desc(inboundMappingVersionsTable.version)).limit(1);
  const [row] = await db.insert(inboundMappingVersionsTable).values({
    integrationId, version: (latest?.version ?? 0) + 1, mappingJson: checked.mapping as unknown as Record<string, unknown>,
    createdBy: req.user!.userId,
  }).returning();
  res.status(201).json(row);
});

adminRouter.post("/inbound-integrations/:id/mappings/:versionId/publish", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id), versionId = int(req.params.versionId);
  if (!id || !versionId) { res.status(400).json({ error: "Invalid id" }); return; }
  const [mapping] = await db.select().from(inboundMappingVersionsTable).where(and(eq(inboundMappingVersionsTable.id, versionId), eq(inboundMappingVersionsTable.integrationId, id)));
  if (!mapping) { res.status(404).json({ error: "Mapping not found" }); return; }
  const checked = validateInboundMapping(mapping.mappingJson);
  if (!checked.ok) { res.status(400).json({ error: "Mapping is no longer valid", details: checked.errors }); return; }
  await db.transaction(async (tx) => {
    await tx.update(inboundMappingVersionsTable).set({ state: "published", publishedAt: new Date() }).where(eq(inboundMappingVersionsTable.id, versionId));
    await tx.update(inboundIntegrationsTable).set({ publishedMappingVersionId: versionId }).where(eq(inboundIntegrationsTable.id, id));
  });
  const [published] = await db.select().from(inboundMappingVersionsTable).where(eq(inboundMappingVersionsTable.id, versionId));
  res.json(published);
});

adminRouter.post("/inbound-integrations/analyze-sample", requireAuth, requireAdmin("inboundIntegrations"), (req, res) => {
  const paths: { path: string; type: string; sample: unknown }[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (paths.length >= 500 || depth > 12) return;
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    paths.push({ path: path || "$", type, sample: type === "object" || type === "array" ? undefined : value });
    if (Array.isArray(value)) value.slice(0, 3).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k, depth + 1));
  };
  walk(req.body, "", 0); res.json({ paths });
});

adminRouter.post("/inbound-integrations/:id/dry-run", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const integrationId = int(req.params.id);
  const mappingVersionId = int(req.body?.mappingVersionId);
  if (!integrationId || !mappingVersionId || req.body?.sample === undefined) { res.status(400).json({ error: "mappingVersionId and sample are required" }); return; }
  const [mapping] = await db.select().from(inboundMappingVersionsTable).where(and(eq(inboundMappingVersionsTable.id, mappingVersionId), eq(inboundMappingVersionsTable.integrationId, integrationId)));
  if (!mapping) { res.status(404).json({ error: "Mapping not found" }); return; }
  const checked = validateInboundMapping(mapping.mappingJson);
  if (!checked.ok) { res.status(400).json({ error: "Invalid mapping", details: checked.errors }); return; }
  const [delivery] = await db.insert(inboundDeliveriesTable).values({
    integrationId, mappingVersionId, eventId: `dry-run:${randomBytes(12).toString("hex")}`,
    payloadHash: hashInboundSecret(JSON.stringify(req.body.sample)), payloadJson: req.body.sample,
    status: "processing", processingStartedAt: new Date(), attemptCount: 1,
  }).returning();
  await processDelivery(delivery!.id, true);
  const [result] = await db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, delivery!.id));
  const steps = await db.select().from(inboundDeliveryStepLogsTable).where(eq(inboundDeliveryStepLogsTable.deliveryId, delivery!.id));
  res.json({ delivery: result, steps, dryRun: true });
});

adminRouter.post("/inbound-deliveries/:id/reprocess", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id); if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [current] = await db.select({ status: inboundDeliveriesTable.status }).from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, id));
  if (!current) { res.status(404).json({ error: "Delivery not found" }); return; }
  if (current.status === "processing") { res.status(409).json({ error: "Delivery is currently processing" }); return; }
  const [row] = await db.update(inboundDeliveriesTable)
    .set({ status: "queued", errorCode: null, errorMessage: null, completedAt: null, processingStartedAt: null })
    // Recheck the snapshot state: a worker may claim/complete between the
    // read above and this reset, and resetting that newer state would replay it.
    .where(and(eq(inboundDeliveriesTable.id, id), eq(inboundDeliveriesTable.status, current.status)))
    .returning();
  if (!row) {
    const [latest] = await db.select({ id: inboundDeliveriesTable.id }).from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, id));
    if (!latest) { res.status(404).json({ error: "Delivery not found" }); return; }
    res.status(409).json({ error: "Delivery state changed; it was not reprocessed" });
    return;
  }
  if (req.body?.dryRun === true) {
    await db.update(inboundDeliveriesTable).set({
      status: "processing",
      processingStartedAt: new Date(),
      attemptCount: sql`${inboundDeliveriesTable.attemptCount} + 1`,
    }).where(eq(inboundDeliveriesTable.id, id));
    void processDelivery(id, true).catch(() => {});
  } else {
    void recoverInboundDeliveries(1).catch(() => {});
  }
  res.status(202).json(row);
});

adminRouter.get("/inbound-deliveries/:id", requireAuth, requireAdmin("inboundIntegrations"), async (req, res): Promise<void> => {
  const id = int(req.params.id); if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [delivery] = await db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, id));
  if (!delivery) { res.status(404).json({ error: "Delivery not found" }); return; }
  const steps = await db.select().from(inboundDeliveryStepLogsTable).where(eq(inboundDeliveryStepLogsTable.deliveryId, id)).orderBy(inboundDeliveryStepLogsTable.createdAt);
  res.json({ ...delivery, steps });
});

inboundWebhookRouter.post("/api/webhooks/inbound/:integrationId", async (req, res): Promise<void> => {
  const integrationId = int(req.params.integrationId);
  const secret = parseInboundBearer(req.header("authorization"));
  if (!integrationId || !secret) { res.status(401).json({ error: "Invalid webhook credentials" }); return; }
  const [integration] = await db.select().from(inboundIntegrationsTable)
    .innerJoin(usersTable, eq(usersTable.id, inboundIntegrationsTable.userId))
    .where(and(eq(inboundIntegrationsTable.id, integrationId), eq(inboundIntegrationsTable.tokenHash, hashInboundSecret(secret))));
  if (!integration || !integration.inbound_integrations.isActive || !integration.users.isActive) { res.status(401).json({ error: "Invalid webhook credentials" }); return; }
  if (!req.is("application/json")) { res.status(415).json({ error: "Content-Type must be application/json" }); return; }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (raw.length > integration.inbound_integrations.maxBodyBytes) { res.status(413).json({ error: "Webhook body is too large" }); return; }
  let payload: unknown;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  const eventId = (req.header("x-event-id") ?? "").trim();
  if (!eventId || eventId.length > 255) { res.status(400).json({ error: "A valid X-Event-Id header is required" }); return; }
  const payloadHash = hashInboundSecret(raw);
  try {
    const [delivery] = await db.insert(inboundDeliveriesTable).values({
      integrationId, eventId, payloadHash, payloadJson: payload, mappingVersionId: integration.inbound_integrations.publishedMappingVersionId, status: "queued",
    }).returning();
    void db.update(inboundIntegrationsTable).set({ lastUsedAt: new Date() }).where(eq(inboundIntegrationsTable.id, integrationId));
    res.status(202).json({ deliveryId: delivery!.id, status: "queued" });
    void recoverInboundDeliveries(1).catch(() => {});
  } catch (err) {
    const [existing] = await db.select().from(inboundDeliveriesTable).where(and(eq(inboundDeliveriesTable.integrationId, integrationId), eq(inboundDeliveriesTable.eventId, eventId)));
    if (!existing) throw err;
    if (classifyInboundDuplicate(existing.payloadHash, payloadHash) === "conflict") { res.status(409).json({ error: "Event id was already used with a different payload", deliveryId: existing.id }); return; }
    res.status(202).json({ deliveryId: existing.id, status: existing.status, duplicate: true });
  }
});

async function processDelivery(deliveryId: number, dryRun: boolean): Promise<void> {
  const [delivery] = await db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, deliveryId));
  if (!delivery) return;
  const [integration] = await db.select().from(inboundIntegrationsTable).where(eq(inboundIntegrationsTable.id, delivery.integrationId));
  if (!integration?.isActive || !delivery.mappingVersionId) {
    await failDelivery(deliveryId, "mapping_unavailable", "No active published mapping");
    return;
  }
  const [version] = await db.select().from(inboundMappingVersionsTable).where(eq(inboundMappingVersionsTable.id, delivery.mappingVersionId));
  const checked = validateInboundMapping(version?.mappingJson);
  if (!checked.ok) { await failDelivery(deliveryId, "mapping_invalid", checked.errors.join("; ")); return; }
  const authReq = { user: { userId: integration.userId, roleId: integration.roleId }, body: {}, params: {}, query: {} } as unknown as Request;
  let currentStepKey: string | null = null;
  const validatedStepKeys: string[] = [];
  try {
    const committedEvents = await db.transaction(async (tx) => {
      // Hold the delivery row for the entire business transaction. A stale-job
      // recovery UPDATE waits here and rechecks its status after commit, so a
      // long-running delivery cannot execute twice.
      const [lockedDelivery] = await tx.select({ status: inboundDeliveriesTable.status })
        .from(inboundDeliveriesTable)
        .where(eq(inboundDeliveriesTable.id, deliveryId))
        .for("update");
      if (!lockedDelivery || lockedDelivery.status !== "processing") return [] as EventInput[];
      await lockInboundMapping(tx, checked.mapping.steps);
      const results = new Map<string, { id: number }>();
      const events: EventInput[] = [];
      for (const step of checked.mapping.steps) {
        currentStepKey = step.key;
        const sources = step.source ? readInboundPath(delivery.payloadJson, step.source) : delivery.payloadJson;
        const items = Array.isArray(sources) ? sources : [sources];
        for (const source of items) await executeStep(tx, authReq, integration.id, deliveryId, step, source, results, events);
        validatedStepKeys.push(step.key);
      }
      if (dryRun) throw new DryRunRollback();
      await tx.update(inboundDeliveriesTable).set({
        status: "completed",
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      }).where(eq(inboundDeliveriesTable.id, deliveryId));
      return events;
    });
    if (committedEvents.length > 0) await emitEvent(committedEvents);
  } catch (err) {
    if (err instanceof DryRunRollback) {
      if (validatedStepKeys.length > 0) {
        await db.insert(inboundDeliveryStepLogsTable).values(validatedStepKeys.map((stepKey) => ({
          deliveryId,
          stepKey,
          status: "completed",
          action: "validated",
          message: "Dry run passed; changes rolled back",
        })));
      }
      await db.update(inboundDeliveriesTable).set({ status: "completed_with_warnings", completedAt: new Date(), errorCode: "dry_run", errorMessage: "Validated successfully; changes rolled back" }).where(eq(inboundDeliveriesTable.id, deliveryId));
      return;
    }
    if (dryRun && validatedStepKeys.length > 0) {
      await db.insert(inboundDeliveryStepLogsTable).values(validatedStepKeys.map((stepKey) => ({
        deliveryId,
        stepKey,
        status: "completed",
        action: "validated",
        message: "Dry run step passed before a later step failed",
      })));
    }
    if (currentStepKey) {
      await db.insert(inboundDeliveryStepLogsTable).values({
        deliveryId,
        stepKey: currentStepKey,
        status: "failed",
        message: errorMessage(err),
      });
    }
    await failDelivery(deliveryId, "processing_failed", errorMessage(err));
  }
}

class DryRunRollback extends Error {}
type Executor = DbExecutor;

async function executeStep(
  tx: Executor,
  req: Request,
  integrationId: number,
  deliveryId: number,
  step: InboundStep,
  source: unknown,
  results: Map<string, { id: number }>,
  events: EventInput[],
): Promise<void> {
  if (step.target.kind === "user") {
    await executeUserStep(tx, req, integrationId, deliveryId, step, source, results, events);
    return;
  }
  if (step.target.kind === "page") {
    await executePageStep(tx, req, integrationId, deliveryId, step, source, results, events);
    return;
  }
  const entityId = step.target.entityId;
  const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const perms = await getPermissions(req);
  const rp = await effectiveRecordPerm(req, perms, entityId, step.target.pageId);
  const access = await fieldAccessContext(req, entityId, fields, step.target.pageId);
  const values = Object.fromEntries(Object.entries(step.values ?? {}).map(([k, v]) => [k, resolveInboundValue(v, source, results)]));
  for (const key of Object.keys(values)) if (!access.editable.has(key)) throw new Error(`Step ${step.key}: field ${key} is not editable`);
  let existing = await findMatch(tx, integrationId, step, source, results, access.hidden);
  if (step.operation === "find") {
    if (!existing) throw new Error(`Step ${step.key}: record not found`);
    results.set(step.key, { id: existing.id });
    await logStep(tx, deliveryId, step.key, "completed", "found", existing.id);
    return;
  }
  const action = existing ? "update" : "create";
  if (step.operation === "update" && !existing) throw new Error(`Step ${step.key}: record not found`);
  if (step.operation === "create" && existing) throw new Error(`Step ${step.key}: record already exists`);
  if (rp?.[action] !== true && !perms.superAdmin) throw new Error(`Step ${step.key}: role cannot ${action} records`);
  if (existing) {
    const relatedIds = (step.links ?? []).map((link) => results.get(link.toStep)?.id).filter((id): id is number => id != null);
    const lockIds = [...new Set([existing.id, ...relatedIds])].sort((a, b) => a - b);
    const lockedRows = await tx.select().from(entityRecordsTable)
      .where(inArray(entityRecordsTable.id, lockIds))
      .orderBy(entityRecordsTable.id)
      .for("update");
    const locked = lockedRows.find((record) => record.id === existing!.id && record.entityId === entityId && record.archivedAt == null);
    if (!locked) throw new Error(`Step ${step.key}: record disappeared during update`);
    existing = locked;
    const scope = await effectiveScopeFor(req, perms, entityId, step.target.pageId);
    if (scope.scope === "own" && !(await isRecordOwned(entityId, existing, scope.scopeFieldKeys, req.user!.userId, fields, tx))) throw new Error(`Step ${step.key}: record is outside row scope`);
    const previous = (existing.valuesJson as Record<string, unknown>) ?? {};
    const merged = { ...previous, ...values };
    const validated = validateValues(fields, merged, false, previous);
    if ("error" in validated) throw new Error(validated.error);
    const err = await validateFinal(tx, entityId, fields, validated.values, existing.id, previous);
    if (err) throw new Error(err);
    const changes = diffValues(previous, validated.values, fields.map((field) => field.fieldKey));
    const [row] = await tx.update(entityRecordsTable).set({
      valuesJson: validated.values,
      version: sql`${entityRecordsTable.version} + 1`,
    }).where(eq(entityRecordsTable.id, existing.id)).returning({
      id: entityRecordsTable.id,
      version: entityRecordsTable.version,
    });
    if (changes.length > 0) {
      await tx.insert(auditLogTable).values(changes.map((change) => ({
        entityId,
        recordId: row!.id,
        ...change,
        userId: req.user!.userId,
      })));
    }
    events.push({
      eventName: EVENT_RECORD_UPDATED,
      entityId,
      recordId: row!.id,
      payload: { actorUserId: req.user!.userId, changedFields: changes.map((change) => change.fieldKey), version: row!.version },
    });
    results.set(step.key, row!); await logStep(tx, deliveryId, step.key, "completed", "updated", row!.id);
  } else {
    const validated = validateValues(fields, values, false);
    if ("error" in validated) throw new Error(validated.error);
    const err = await validateFinal(tx, entityId, fields, validated.values);
    if (err) throw new Error(err);
    const [defaultStatus] = await tx.select({ id: entityStatusesTable.id }).from(entityStatusesTable)
      .where(and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.isDefault, true))).limit(1);
    const [row] = await tx.insert(entityRecordsTable).values({
      entityId,
      valuesJson: validated.values,
      statusId: defaultStatus?.id ?? null,
      statusChangedAt: new Date(),
    }).returning({ id: entityRecordsTable.id, version: entityRecordsTable.version, statusId: entityRecordsTable.statusId });
    const entries: InsertAuditLog[] = fields.flatMap((field) => {
      const value = auditStr(validated.values[field.fieldKey]);
      return value == null ? [] : [{ entityId, recordId: row!.id, fieldKey: field.fieldKey, oldValue: null, newValue: value, userId: req.user!.userId }];
    });
    if (entries.length === 0) entries.push({ entityId, recordId: row!.id, fieldKey: AUDIT_CREATED, oldValue: null, newValue: null, userId: req.user!.userId });
    await tx.insert(auditLogTable).values(entries);
    events.push({
      eventName: EVENT_RECORD_CREATED,
      entityId,
      recordId: row!.id,
      payload: { actorUserId: req.user!.userId, statusId: row!.statusId, version: row!.version },
    });
    results.set(step.key, row!); await logStep(tx, deliveryId, step.key, "completed", "created", row!.id);
  }
  await applyStepLinks(tx, req, step, results, events);
  const external = step.externalId;
  if (external) {
    const externalId = String(resolveInboundValue(external.value, source, results) ?? "").trim();
    if (externalId) await tx.insert(inboundExternalObjectMappingsTable).values({ integrationId, objectType: external.objectType, externalId, targetKind: "entity", targetId: results.get(step.key)!.id })
      .onConflictDoUpdate({ target: [inboundExternalObjectMappingsTable.integrationId, inboundExternalObjectMappingsTable.objectType, inboundExternalObjectMappingsTable.externalId], set: { targetId: results.get(step.key)!.id } });
  }
}

/** Link only fixed schema relations to records created/found by earlier steps. */
async function applyStepLinks(tx: Executor, req: Request, step: InboundStep, results: Map<string, { id: number }>, events: EventInput[]): Promise<void> {
  const sourceId = results.get(step.key)?.id;
  if (!sourceId) return;
  const perms = await getPermissions(req);
  for (const link of step.links ?? []) {
    const targetId = results.get(link.toStep)?.id;
    if (!targetId) throw new Error(`Step ${step.key}: link target result is missing`);
    const [relation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, link.relationId)).limit(1);
    if (!relation) throw new Error(`Step ${step.key}: relation ${link.relationId} does not exist`);
    let sourceRecordId: number;
    let targetRecordId: number;
    let sourceEntityId: number;
    let targetEntityId: number;
    if (relation.sourceEntityId === step.target.entityId) {
      sourceRecordId = sourceId; targetRecordId = targetId; sourceEntityId = relation.sourceEntityId; targetEntityId = relation.targetEntityId;
    } else if (relation.targetEntityId === step.target.entityId) {
      sourceRecordId = targetId; targetRecordId = sourceId; sourceEntityId = relation.sourceEntityId; targetEntityId = relation.targetEntityId;
    } else throw new Error(`Step ${step.key}: relation does not belong to its entity`);
    const [target] = await tx.select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId }).from(entityRecordsTable)
      .where(and(eq(entityRecordsTable.id, targetRecordId), sql`${entityRecordsTable.archivedAt} is null`)).limit(1);
    if (!target || target.entityId !== targetEntityId) throw new Error(`Step ${step.key}: relation target has wrong entity`);
    const sourcePerm = await effectiveRecordPerm(req, perms, sourceEntityId);
    const targetPerm = await effectiveRecordPerm(req, perms, targetEntityId);
    if (!perms.superAdmin && (sourcePerm?.update !== true || targetPerm?.view !== true)) throw new Error(`Step ${step.key}: role cannot link these records`);
    // Existing exact links are a no-op. Cardinality constraints remain enforced
    // by the existing database constraints and roll back the whole delivery.
    const inserted = await tx.insert(recordLinksTable).values({
      relationId: relation.id, relationType: relation.relationType, sourceRecordId, targetRecordId,
    }).onConflictDoNothing().returning({ id: recordLinksTable.id });
    if (inserted.length > 0) {
      const touchedIds = [...new Set([sourceRecordId, targetRecordId])].sort((a, b) => a - b);
      const versions = await tx.update(entityRecordsTable).set({
        version: sql`${entityRecordsTable.version} + 1`,
      }).where(inArray(entityRecordsTable.id, touchedIds)).returning({
        id: entityRecordsTable.id,
        entityId: entityRecordsTable.entityId,
        version: entityRecordsTable.version,
      });
      events.push(...versions.map((record) => ({
        eventName: EVENT_RECORD_UPDATED,
        entityId: record.entityId,
        recordId: record.id,
        payload: { actorUserId: req.user!.userId, changedFields: [], version: record.version },
      })));
    }
  }
}

async function executePageStep(tx: Executor, req: Request, integrationId: number, deliveryId: number, step: InboundStep, source: unknown, results: Map<string, { id: number }>, events: EventInput[]) {
  if (step.target.kind !== "page") return;
  const { entityId, pageId } = step.target;
  if (pageId == null) throw new Error(`Step ${step.key}: pageId is required`);
  const entityFields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const entityAccess = await fieldAccessContext(req, entityId, entityFields, pageId);
  const host = await findMatch(tx, integrationId, step, source, results, entityAccess.hidden);
  if (!host) throw new Error(`Step ${step.key}: host record not found`);
  const perms = await getPermissions(req);
  const rp = await effectiveRecordPerm(req, perms, entityId, pageId);
  if (!perms.superAdmin && rp?.update !== true) throw new Error(`Step ${step.key}: role cannot update page records`);
  const scope = await effectiveScopeFor(req, perms, entityId, pageId);
  if (scope.scope === "own" && !(await isRecordOwned(entityId, host, scope.scopeFieldKeys, req.user!.userId, entityFields, tx)))
    throw new Error(`Step ${step.key}: host record is outside row scope`);
  const [fields, roleIds] = await Promise.all([
    tx.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true))),
    getUserRoleIds(req),
  ]);
  const values = Object.fromEntries(Object.entries(step.values ?? {}).map(([k, v]) => [k, resolveInboundValue(v, source, results)]));
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  for (const key of Object.keys(values)) {
    const field = byKey.get(key);
    if (!field || mostPermissiveFieldPerm(field.permissionsJson, roleIds, "edit", perms, entityId, pageId) !== "edit")
      throw new Error(`Step ${step.key}: page field ${key} is not editable`);
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock((${pageId}::bigint << 32) | ${host.id}::bigint)`);
  const [stored] = await tx.select().from(pageRecordValuesTable).where(and(eq(pageRecordValuesTable.pageId, pageId), eq(pageRecordValuesTable.recordId, host.id))).for("update");
  const previous = (stored?.valuesJson as Record<string, unknown> | undefined) ?? {};
  const checked = validatePageValues(fields, { ...previous, ...values }, false, previous);
  if ("error" in checked) throw new Error(checked.error);
  const changedPageFieldKeys = diffValues(previous, checked.values, fields.map((field) => field.fieldKey)).map((change) => change.fieldKey);
  let version: number;
  if (stored) {
    const [written] = await tx.update(pageRecordValuesTable).set({ valuesJson: checked.values, version: sql`${pageRecordValuesTable.version} + 1` })
      .where(eq(pageRecordValuesTable.id, stored.id)).returning({ version: pageRecordValuesTable.version });
    version = written!.version;
  } else {
    const [written] = await tx.insert(pageRecordValuesTable).values({ pageId, recordId: host.id, valuesJson: checked.values })
      .returning({ version: pageRecordValuesTable.version });
    version = written!.version;
  }
  if (changedPageFieldKeys.length > 0) events.push({
    eventName: EVENT_PAGE_FIELD_SAVED,
    entityId,
    recordId: host.id,
    payload: { pageId, changedPageFieldKeys, actorUserId: req.user!.userId, version },
  });
  results.set(step.key, { id: host.id });
  await logStep(tx, deliveryId, step.key, "completed", stored ? "updated" : "created", host.id);
}

async function executeUserStep(tx: Executor, req: Request, integrationId: number, deliveryId: number, step: InboundStep, source: unknown, results: Map<string, { id: number }>, events: EventInput[]) {
  if (step.target.kind !== "user") return;
  const [field] = await tx.select().from(entityFieldsTable).where(eq(entityFieldsTable.id, step.target.fieldId));
  if (!field || field.fieldType !== "user" || field.userConfigJson?.allowCreate !== true)
    throw new Error(`Step ${step.key}: inline user creation is not enabled`);
  const allowed = field.userConfigJson.allowedRoleIds ?? [];
  if (allowed.length > 0 && !allowed.includes(step.target.roleId))
    throw new Error(`Step ${step.key}: configured role is not allowed for this field`);
  const [role] = await tx.select({ permissions: rolesTable.permissionsJson }).from(rolesTable).where(eq(rolesTable.id, step.target.roleId));
  if (!role || isPrivilegedRole(role.permissions)) throw new Error(`Step ${step.key}: privileged user roles are forbidden`);
  const perms = await getPermissions(req);
  const [rp, roleIds] = await Promise.all([
    effectiveRecordPerm(req, perms, field.entityId, step.target.pageId),
    getUserRoleIds(req),
  ]);
  if (!perms.superAdmin && rp?.create !== true && rp?.update !== true) throw new Error(`Step ${step.key}: role cannot create users inline`);
  if (resolveFieldAccess(field, perms, roleIds, field.entityId, rp, step.target.pageId) !== "edit")
    throw new Error(`Step ${step.key}: inline user field is not editable`);
  const values = Object.fromEntries(Object.entries(step.values ?? {}).map(([k, v]) => [k, resolveInboundValue(v, source, results)]));
  const email = String(values.email ?? "").trim().toLowerCase();
  let id = await findUserMatch(tx, integrationId, step, source, results);
  let createdUser = false;
  if (!id && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Step ${step.key}: valid email is required`);
  if (!id) {
    if (step.operation === "find" || step.operation === "update") throw new Error(`Step ${step.key}: user not found`);
    const [created] = await tx.insert(usersTable).values({
      email, passwordHash: null,
      firstName: String(values.firstName ?? email.split("@")[0] ?? "").trim(),
      lastName: String(values.lastName ?? "").trim(),
      roleId: step.target.roleId,
    }).returning({ id: usersTable.id });
    id = created!.id;
    createdUser = true;
    await tx.insert(userRolesTable).values({ userId: id, roleId: step.target.roleId }).onConflictDoNothing();
    events.push({
      eventName: EVENT_USER_CREATED,
      payload: { actorUserId: req.user!.userId, userId: id, roleId: step.target.roleId },
    });
  } else if (step.operation === "create") throw new Error(`Step ${step.key}: user already exists`);
  results.set(step.key, { id });
  const external = step.externalId;
  if (external) {
    const externalId = String(resolveInboundValue(external.value, source, results) ?? "").trim();
    if (externalId) await tx.insert(inboundExternalObjectMappingsTable).values({ integrationId, objectType: external.objectType, externalId, targetKind: "user", targetId: id })
      .onConflictDoUpdate({ target: [inboundExternalObjectMappingsTable.integrationId, inboundExternalObjectMappingsTable.objectType, inboundExternalObjectMappingsTable.externalId], set: { targetId: id } });
  }
  await logStep(tx, deliveryId, step.key, "completed", createdUser ? "created" : "found", id);
}

async function lockInboundMapping(tx: Executor, steps: InboundStep[]): Promise<void> {
  // The key intentionally excludes integrationId: independently configured
  // webhooks writing the same ERP target must serialize matching + creation.
  const targetKeys = [...new Set(steps.flatMap((step) => {
    if (step.target.kind === "entity") return [`entity:${step.target.entityId}`];
    if (step.target.kind === "page") return [`entity:${step.target.entityId}`, `page:${step.target.pageId}`];
    return ["users"];
  }))].sort();
  for (const key of targetKeys) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inbound-target:${key}`}, 0))`);
  }

  // Shared link writers lock relation rows before record rows. Do the same for
  // every relation in the mapping before any step can lock/update a record.
  const relationIds = [...new Set(steps.flatMap((step) => (step.links ?? []).map((link) => link.relationId)))].sort((a, b) => a - b);
  if (relationIds.length > 0) {
    const locked = await tx.select({ id: relationsTable.id }).from(relationsTable)
      .where(inArray(relationsTable.id, relationIds))
      .orderBy(relationsTable.id)
      .for("update");
    if (locked.length !== relationIds.length) throw new Error("One or more configured relations no longer exist");
  }
}

async function findUserMatch(tx: Executor, integrationId: number, step: InboundStep, source: unknown, results: Map<string, { id: number }>): Promise<number | null> {
  for (const match of step.matches ?? []) {
    if (match.kind === "system_id") {
      const id = Number(match.value ? resolveInboundValue(match.value, source, results) : undefined);
      if ((!Number.isInteger(id) || id <= 0) && match.skipWhenEmpty) continue;
      const [row] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
      if (row) return row.id;
      if (match.onMissingExplicitId !== "continue") throw new Error(`Explicit user id ${id} does not exist`);
      continue;
    }
    if (match.kind === "external") {
      const externalId = String(match.value ? resolveInboundValue(match.value, source, results) ?? "" : "").trim();
      if (!externalId && match.skipWhenEmpty) continue;
      const [mapped] = await tx.select({ targetId: inboundExternalObjectMappingsTable.targetId }).from(inboundExternalObjectMappingsTable)
        .where(and(eq(inboundExternalObjectMappingsTable.integrationId, integrationId), eq(inboundExternalObjectMappingsTable.objectType, match.objectType ?? ""), eq(inboundExternalObjectMappingsTable.externalId, externalId), eq(inboundExternalObjectMappingsTable.targetKind, "user")));
      if (mapped) return mapped.targetId;
      continue;
    }
    const clauses: SQL[] = [];
    for (const condition of match.conditions ?? []) {
      if (!["email", "firstName", "lastName"].includes(condition.fieldKey)) throw new Error(`User match field ${condition.fieldKey} is not allowed`);
      const raw = resolveInboundValue(condition.value, source, results);
      if ((raw == null || raw === "") && match.skipWhenEmpty) { clauses.length = 0; break; }
      const value = String(raw ?? "").trim().toLowerCase();
      const column = condition.fieldKey === "email" ? usersTable.email : condition.fieldKey === "firstName" ? usersTable.firstName : usersTable.lastName;
      clauses.push(sql`lower(trim(${column})) = ${value}`);
    }
    if (clauses.length === 0) continue;
    const rows = await tx.select({ id: usersTable.id }).from(usersTable).where(and(...clauses)).limit(2);
    if (rows.length > 1) throw new Error(`User match is ambiguous`);
    if (rows[0]) return rows[0].id;
  }
  return null;
}

async function validateFinal(tx: Executor, entityId: number, fields: typeof entityFieldsTable.$inferSelect[], values: Record<string, unknown>, id?: number, previous?: Record<string, unknown>): Promise<string | null> {
  return await validateUserRefs(fields, values, tx) ??
    await checkDependentValues(entityId, fields, values, id, tx) ??
    checkValidationRules(fields, values) ??
    (previous ? checkImmutableFields(fields, values, previous) : null) ??
    await checkUniqueKeys(tx, entityId, fields.filter((f) => f.isKey), values, id);
}

async function findMatch(tx: Executor, integrationId: number, step: InboundStep, source: unknown, results: Map<string, { id: number }>, hidden: Set<string>) {
  if (step.target.kind === "user") return null;
  for (const match of step.matches ?? []) {
    const found = await runMatch(tx, integrationId, step.target.entityId, match, source, results, hidden);
    if (found === "continue") continue;
    if (found) return found;
  }
  return null;
}

async function runMatch(tx: Executor, integrationId: number, entityId: number, match: InboundMatch, source: unknown, results: Map<string, { id: number }>, hidden: Set<string>) {
  if (match.kind === "external") {
    const externalId = String(match.value ? resolveInboundValue(match.value, source, results) ?? "" : "").trim();
    if (!externalId && match.skipWhenEmpty) return "continue" as const;
    const [mapped] = await tx.select({ targetId: inboundExternalObjectMappingsTable.targetId }).from(inboundExternalObjectMappingsTable).where(and(
      eq(inboundExternalObjectMappingsTable.integrationId, integrationId), eq(inboundExternalObjectMappingsTable.objectType, match.objectType ?? ""), eq(inboundExternalObjectMappingsTable.externalId, externalId),
    ));
    if (!mapped) return null;
    const [record] = await tx.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, mapped.targetId), eq(entityRecordsTable.entityId, entityId), sql`${entityRecordsTable.archivedAt} is null`));
    return record ?? null;
  }
  if (match.kind === "system_id") {
    const id = Number(match.value ? resolveInboundValue(match.value, source, results) : undefined);
    if ((!Number.isInteger(id) || id <= 0) && match.skipWhenEmpty) return "continue" as const;
    const [record] = await tx.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, id), eq(entityRecordsTable.entityId, entityId), sql`${entityRecordsTable.archivedAt} is null`));
    if (!record && match.onMissingExplicitId !== "continue") throw new Error(`Explicit ERP id ${id} does not exist`);
    return record ?? "continue" as const;
  }
  const clauses = [eq(entityRecordsTable.entityId, entityId), sql`${entityRecordsTable.archivedAt} is null`];
  for (const condition of match.conditions ?? []) {
    if (hidden.has(condition.fieldKey)) throw new Error(`Match field ${condition.fieldKey} is hidden`);
    const value = resolveInboundValue(condition.value, source, results);
    if ((value == null || value === "") && match.skipWhenEmpty) return "continue" as const;
    clauses.push(sql`${entityRecordsTable.valuesJson} ->> ${condition.fieldKey} = ${String(value ?? "")}`);
  }
  if (match.parent) {
    if (hidden.has(match.parent.fieldKey)) throw new Error(`Parent match field ${match.parent.fieldKey} is hidden`);
    clauses.push(sql`${entityRecordsTable.valuesJson} ->> ${match.parent.fieldKey} = ${String(results.get(match.parent.step)?.id ?? "")}`);
  }
  const rows = await tx.select().from(entityRecordsTable).where(and(...clauses)).limit(2);
  if (rows.length > 1) throw new Error(`Match is ambiguous for entity ${entityId}`);
  return rows[0] ?? null;
}

async function logStep(tx: Executor, deliveryId: number, stepKey: string, status: string, action: string, targetId: number) {
  await tx.insert(inboundDeliveryStepLogsTable).values({ deliveryId, stepKey, status, action, targetId });
}
async function failDelivery(id: number, code: string, message: string) {
  await db.update(inboundDeliveriesTable).set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 1000), completedAt: new Date() }).where(eq(inboundDeliveriesTable.id, id));
}

/**
 * Atomically claim and execute one eligible delivery. Exported as a narrow
 * worker seam so the real PostgreSQL claim can be regression-tested without
 * making a recovery scan touch unrelated development rows.
 */
export async function claimAndProcessInboundDelivery(deliveryId: number): Promise<boolean> {
  const [claimed] = await db.update(inboundDeliveriesTable)
    .set({
      status: "processing",
      processingStartedAt: new Date(),
      attemptCount: sql`${inboundDeliveriesTable.attemptCount} + 1`,
    })
    .where(and(eq(inboundDeliveriesTable.id, deliveryId), sql`(${inboundDeliveriesTable.status} = 'queued' OR (${inboundDeliveriesTable.status} = 'processing' AND ${inboundDeliveriesTable.processingStartedAt} < now() - interval '10 minutes'))`))
    .returning({ id: inboundDeliveriesTable.id });
  if (!claimed) return false;
  await processDelivery(claimed.id, false);
  return true;
}

/** Persistent recovery worker: claim rows atomically so processes never execute a job twice. */
export async function recoverInboundDeliveries(limit = 10): Promise<void> {
  const candidates = await db.select({ id: inboundDeliveriesTable.id }).from(inboundDeliveriesTable)
    .where(sql`(${inboundDeliveriesTable.status} = 'queued' OR (${inboundDeliveriesTable.status} = 'processing' AND ${inboundDeliveriesTable.processingStartedAt} < now() - interval '10 minutes'))`)
    .orderBy(inboundDeliveriesTable.receivedAt).limit(limit);
  await Promise.all(candidates.map((candidate) => claimAndProcessInboundDelivery(candidate.id)));
}

/** Insert the system module row once so it appears in the Modules registry. */
export async function ensureInboundIntegrationsModule(): Promise<void> {
  await db.insert(modulesTable).values({
    moduleKey: INBOUND_INTEGRATIONS_MODULE_KEY,
    nameJson: { ru: "Входящие интеграции", en: "Inbound Integrations", he: "אינטגרציות נכנסות" },
    version: "1.0.0",
    isEnabled: true,
  }).onConflictDoNothing({ target: modulesTable.moduleKey });
}

export default adminRouter;