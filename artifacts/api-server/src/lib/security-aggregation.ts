import { createHash } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, securityEventsTable as events } from "@workspace/db";

export const SECURITY_AGGREGATION_WINDOW_MS = 5 * 60_000;
export const SECURITY_AGGREGATION_GROUP_LIMIT = 100;

/** Only attempts and UNAUTHENTICATED failures are coalesced. Successful actions
 * and failures attributed to a verified actor are always individual evidence. */
export async function storeSecurityEvidence(row: typeof events.$inferInsert) {
  const aggregate = row.outcome === "attempt" ||
    (!row.actorUserId && ["denied", "failure", "interrupted"].includes(row.outcome));
  if (!aggregate) { await db.insert(events).values(row); return; }
  const now = new Date();
  const bucket = Math.floor(now.getTime() / SECURITY_AGGREGATION_WINDOW_MS);
  const key = `${bucket}:` + createHash("sha256").update(JSON.stringify([
    row.action, row.outcome, row.clientIp, row.loginEmail, row.route, row.method, row.reason,
    row.targetUserId, row.detailsJson?.targetAgentId, row.detailsJson?.targetRoleId,
    row.detailsJson?.targetIntegrationId,
  ])).digest("hex");
  await db.transaction(async (tx) => {
    // A database lock also coordinates multiple API processes. No in-memory,
    // attacker-controlled key map or unbounded background aggregation queue.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(736482, ${bucket})`);
    let effectiveKey = key;
    const [existing] = await tx.select({ id: events.id }).from(events).where(eq(events.aggregationKey, key)).limit(1);
    if (!existing) {
      const used = await tx.execute(sql`SELECT count(*)::int AS n FROM ${events}
        WHERE ${events.aggregationKey} >= ${`${bucket}:`}
          AND ${events.aggregationKey} < ${`${bucket + 1}:`}`);
      if (Number(used.rows[0]?.n ?? 0) >= SECURITY_AGGREGATION_GROUP_LIMIT) effectiveKey = `${bucket}:overflow`;
    }
    const overflow = effectiveKey.endsWith(":overflow");
    const value = overflow ? {
      requestId: row.requestId, action: "audit.overflow", outcome: "summary",
      severity: "warning", isAlert: true, authSource: "mixed", peerIp: "multiple",
      clientIp: "multiple", ipSource: "not-retained", method: "MULTIPLE", route: "/[multiple]",
      detailsJson: { sourceDetailsTruncated: true, aggregationWindowMinutes: 5 },
    } : {
      ...row, detailsJson: { ...row.detailsJson, aggregationWindowMinutes: 5, firstRequestSampleOnly: true },
    };
    await tx.insert(events).values({ ...value, aggregationKey: effectiveKey, lastSeenAt: now })
      .onConflictDoUpdate({
        target: events.aggregationKey,
        set: {
          occurrenceCount: sql`${events.occurrenceCount} + 1`,
          lastSeenAt: now,
          isAlert: sql`${events.isAlert} OR ${value.isAlert ?? false}`,
          severity: sql`CASE WHEN ${events.isAlert} OR ${value.isAlert ?? false} THEN 'warning' ELSE ${events.severity} END`,
        },
      });
  });
}
