import { createHash } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, securityEventsTable as events } from "@workspace/db";
import { revokedSessionGroup, addRevokedRequest } from "./revoked-session-summary";
import { isOptionalFilterDenial } from "./security-alert-policy";
import { invalidTokenGroup, invalidTokenSummary } from "./invalid-token-episode";

export const SECURITY_AGGREGATION_WINDOW_MS = 5 * 60_000;
export const SECURITY_AGGREGATION_GROUP_LIMIT = 100;

/** Successful actions and ordinary verified-actor failures stay individual.
 * Revoked sessions retain identity/source plus bounded cross-route summaries. */
export async function storeSecurityEvidence(row: typeof events.$inferInsert) {
  const revokedGroup = revokedSessionGroup(row);
  const invalidGroup = invalidTokenGroup(row);
  const aggregate = revokedGroup !== null || isOptionalFilterDenial(row) || row.outcome === "attempt" ||
    (!row.actorUserId && ["denied", "failure", "interrupted"].includes(row.outcome));
  if (!aggregate) { await db.insert(events).values(row); return; }
  const now = new Date();
  const bucket = Math.floor(now.getTime() / SECURITY_AGGREGATION_WINDOW_MS);
  const digest = createHash("sha256").update(JSON.stringify(invalidGroup ?? revokedGroup ?? [
    row.action, row.outcome, row.clientIp, row.loginEmail, row.route, row.method, row.reason,
    row.targetUserId, row.detailsJson?.targetAgentId, row.detailsJson?.targetRoleId,
    row.detailsJson?.targetIntegrationId,
    row.actorUserId, row.sessionRef, row.detailsJson?.targetEntityId,
  ])).digest("hex");
  const key = `${invalidGroup ? "invalid-token-v1" : bucket}:${digest}`;
  await db.transaction(async (tx) => {
    // Stable episode lock serializes route summaries even across time buckets.
    if (invalidGroup) await tx.execute(sql`SELECT pg_advisory_xact_lock(736483, ${Buffer.from(digest, "hex").readInt32BE(0)})`);
    // A database lock also coordinates multiple API processes. No in-memory,
    // attacker-controlled key map or unbounded background aggregation queue.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(736482, ${bucket})`);
    let effectiveKey = key;
    const [existing] = await tx.select({ id: events.id, detailsJson: events.detailsJson }).from(events).where(eq(events.aggregationKey, key)).limit(1);
    if (!existing) {
      const used = await tx.execute(sql`SELECT count(*)::int AS n FROM ${events}
        WHERE (${events.aggregationKey} >= ${`${bucket}:`}
          AND ${events.aggregationKey} < ${`${bucket + 1}:`})
          OR (${events.aggregationKey} LIKE 'invalid-token-v1:%'
            AND ${events.createdAt} >= ${new Date(bucket * SECURITY_AGGREGATION_WINDOW_MS)})`);
      if (Number(used.rows[0]?.n ?? 0) >= SECURITY_AGGREGATION_GROUP_LIMIT) effectiveKey = `${bucket}:overflow`;
    }
    const overflow = effectiveKey.endsWith(":overflow");
    const summary = invalidGroup && !overflow
      ? invalidTokenSummary(existing?.detailsJson ?? row.detailsJson, row.method, row.route)
      : revokedGroup && !overflow
      ? addRevokedRequest(existing?.detailsJson ?? row.detailsJson, row.method, row.route)
      : null;
    const value = overflow ? {
      requestId: row.requestId, action: "audit.overflow", outcome: "summary",
      severity: "warning", isAlert: true, authSource: "mixed", peerIp: "multiple",
      clientIp: "multiple", ipSource: "not-retained", method: "MULTIPLE", route: "/[multiple]",
      detailsJson: { sourceDetailsTruncated: true, aggregationWindowMinutes: 5 },
    } : {
      ...row, detailsJson: summary ?? { ...row.detailsJson, aggregationWindowMinutes: 5, firstRequestSampleOnly: true },
    };
    await tx.insert(events).values({ ...value, aggregationKey: effectiveKey, lastSeenAt: now })
      .onConflictDoUpdate({
        target: events.aggregationKey,
        set: {
          occurrenceCount: sql`${events.occurrenceCount} + 1`,
          lastSeenAt: sql`GREATEST(clock_timestamp(), ${events.lastSeenAt}) + interval '1 microsecond'`,
          ...(summary ? { detailsJson: summary } : {}),
          isAlert: sql`${events.isAlert} OR ${value.isAlert ?? false}`,
          severity: sql`CASE WHEN ${events.isAlert} OR ${value.isAlert ?? false} THEN 'warning' ELSE ${events.severity} END`,
        },
      });
  });
}
