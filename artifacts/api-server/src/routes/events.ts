import { Router, type IRouter } from "express";
import { db, systemEventsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql, inArray, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";

const router: IRouter = Router();

const MAX_LIMIT = 200;

/**
 * Stage 14 — Event System read endpoint.
 *
 * Lists persisted system events (newest first) with optional filters and
 * pagination. Gated by the `events` admin capability (superAdmin bypasses).
 * Actor names are resolved from each event's `payloadJson.actorUserId`.
 */
router.get("/events", requireAuth, requireAdmin("events"), async (req, res): Promise<void> => {
  const eventName = typeof req.query.eventName === "string" && req.query.eventName.trim() !== ""
    ? req.query.eventName.trim()
    : undefined;
  const entityIdRaw = req.query.entityId;
  const entityId = entityIdRaw != null && entityIdRaw !== "" ? Number(entityIdRaw) : undefined;
  if (entityId != null && !Number.isInteger(entityId)) {
    res.status(400).json({ error: "Invalid entityId" });
    return;
  }

  const limitRaw = Math.trunc(Number(req.query.limit));
  const offsetRaw = Math.trunc(Number(req.query.offset));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : 50;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  const conditions: SQL[] = [];
  if (eventName) conditions.push(eq(systemEventsTable.eventName, eventName));
  if (entityId != null) conditions.push(eq(systemEventsTable.entityId, entityId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(systemEventsTable)
    .where(where);

  const rows = await db
    .select()
    .from(systemEventsTable)
    .where(where)
    .orderBy(desc(systemEventsTable.createdAt), desc(systemEventsTable.id))
    .limit(limit)
    .offset(offset);

  // Resolve actor names from payload.actorUserId in one batched query.
  const actorIds = Array.from(
    new Set(
      rows
        .map((r) => {
          const p = (r.payloadJson as Record<string, unknown>) ?? {};
          const id = p.actorUserId;
          return typeof id === "number" && Number.isInteger(id) ? id : null;
        })
        .filter((id): id is number => id != null),
    ),
  );

  const actorMap = new Map<number, string>();
  if (actorIds.length > 0) {
    const users = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, actorIds));
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      actorMap.set(u.id, name || u.email);
    }
  }

  const data = rows.map((r) => {
    const payload = (r.payloadJson as Record<string, unknown>) ?? {};
    const actorUserId = payload.actorUserId;
    const actorName =
      typeof actorUserId === "number" ? actorMap.get(actorUserId) ?? null : null;
    return {
      id: r.id,
      eventName: r.eventName,
      entityId: r.entityId,
      recordId: r.recordId,
      payloadJson: payload,
      actorName,
      createdAt: r.createdAt,
    };
  });

  res.json({ data, total: count });
});

export default router;
