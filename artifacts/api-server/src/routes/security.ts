import { Router, type RequestHandler } from "express";
import { and, or, desc, eq, gte, lte, isNull, getTableColumns, sql } from "drizzle-orm";
import { db, securityEventsTable as events, securityEventReviewsTable as reviews } from "@workspace/db";
import { QuerySecurityEventsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requireSuperAdmin } from "../middlewares/permissions";
import { securityProxyAttribution } from "../lib/security-ip";

const router = Router();
const humanOnly: RequestHandler = (req, res, next) => {
  if (!req.user || req.user.guest || req.user.agentId || req.user.impersonatorId) {
    res.status(403).json({ error: "Only a non-impersonated human super-admin may access security evidence" });
    return;
  }
  next();
};
router.use("/security", requireAuth, humanOnly, requireSuperAdmin());

router.post("/security/events/query", async (req, res) => {
  const parsed = QuerySecurityEventsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid security filters" }); return; }
  const q = parsed.data;
  if (q.from && q.to && new Date(q.from) > new Date(q.to)) {
    res.status(400).json({ error: "Start time must be before end time" }); return;
  }
  const filters = [
    q.from ? gte(events.createdAt, new Date(q.from)) : undefined,
    q.to ? lte(events.createdAt, new Date(q.to)) : undefined,
    q.action ? eq(events.action, q.action) : undefined,
    q.outcome ? eq(events.outcome, q.outcome) : undefined,
    q.actorUserId ? eq(events.actorUserId, q.actorUserId) : undefined,
    q.targetUserId ? eq(events.targetUserId, q.targetUserId) : undefined,
    q.agentId ? or(eq(events.agentId, q.agentId), sql`${events.detailsJson}->>'targetAgentId' = ${String(q.agentId)}`) : undefined,
    q.integrationId ? or(eq(events.integrationId, q.integrationId), sql`${events.detailsJson}->>'targetIntegrationId' = ${String(q.integrationId)}`) : undefined,
    q.sessionRef ? eq(events.sessionRef, q.sessionRef) : undefined,
    q.requestId ? eq(events.requestId, q.requestId) : undefined,
    q.clientIp ? eq(events.clientIp, q.clientIp) : undefined,
    q.loginEmail ? eq(events.loginEmail, q.loginEmail.trim().toLowerCase()) : undefined,
    q.onlyUnreviewed ? and(eq(events.isAlert, true), isNull(reviews.eventId)) : undefined,
  ];
  const where = and(...filters);
  const [data, count] = await Promise.all([
    db.select({ ...getTableColumns(events), reviewedAt: reviews.reviewedAt, reviewedBy: reviews.reviewedBy })
      .from(events).leftJoin(reviews, eq(events.id, reviews.eventId)).where(where)
      .orderBy(desc(events.createdAt), desc(events.id)).limit(q.limit ?? 50).offset(q.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(events)
      .leftJoin(reviews, eq(events.id, reviews.eventId)).where(where),
  ]);
  res.json({ data, total: count[0]?.total ?? 0 });
});

router.get("/security/summary", async (_req, res) => {
  const [counts] = await db.select({
    unreviewedAlerts: sql<number>`count(*) filter (where ${events.isAlert} and ${reviews.eventId} is null)::int`,
    failedLogins24h: sql<number>`count(*) filter (where ${events.action}='auth.login' and ${events.outcome}='denied' and ${events.createdAt} >= now() - interval '24 hours')::int`,
    deniedRequests24h: sql<number>`count(*) filter (where ${events.outcome}='denied' and ${events.action}<>'auth.login' and ${events.createdAt} >= now() - interval '24 hours')::int`,
    criticalChanges24h: sql<number>`count(*) filter (where ${events.severity}='critical' and ${events.outcome}='success' and ${events.createdAt} >= now() - interval '24 hours')::int`,
  }).from(events).leftJoin(reviews, eq(events.id, reviews.eventId));
  res.json({ ...counts, proxyAttribution: securityProxyAttribution });
});

router.post("/security/events/:eventId/review", async (req, res) => {
  const id = Number(req.params.eventId);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid event id" }); return; }
  const [event] = await db.select({ id: events.id, isAlert: events.isAlert }).from(events).where(eq(events.id, id));
  if (!event || !event.isAlert) { res.status(404).json({ error: "Alert not found" }); return; }
  await db.insert(reviews).values({ eventId: id, reviewedBy: req.user!.userId }).onConflictDoNothing();
  res.json({ success: true });
});
export default router;
