import { and, eq, inArray, sql } from "drizzle-orm";
import { db, securityEventsTable as events, securityEventReviewsTable as reviews, securityRetentionTable as settings } from "@workspace/db";
import { logger } from "./logger";

type Settings = typeof settings.$inferSelect;
export const RETENTION_BATCH_SIZE = 1000;
export class SecurityCleanupBusyError extends Error {}
export async function getRetentionSettings() {
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row!;
}

// Review state never shortens the evidence lifetime. An aggregate expires only
// after its LAST occurrence; successful authentication remains available for tracing.
export function expiredSecurityEvents(s: Pick<Settings, "ordinaryDays" | "importantDays">) {
  const important = sql`(${events.isAlert} OR ${events.severity} = 'critical'
    OR (${events.action} = 'auth.login' AND ${events.outcome} = 'success')
    OR ${events.action} NOT IN ('auth.login', 'access.denied', 'guest.redeem', 'inbound.receive'))`;
  return sql`${events.lastSeenAt} < now() - (CASE WHEN ${important}
    THEN ${s.importantDays}::integer ELSE ${s.ordinaryDays}::integer END) * interval '1 day'`;
}

export async function getRetentionStatus() {
  const s = await getRetentionSettings();
  const [counts] = await db.select({
    rowCount: sql<number>`count(*)::float8`,
    occurrenceCount: sql<number>`coalesce(sum(${events.occurrenceCount}),0)::float8`,
    expiredCount: sql<number>`count(*) filter (where ${expiredSecurityEvents(s)})::float8`,
  }).from(events);
  // Resolve the active search_path (including isolated test schemas), not public.
  const size = await db.execute(sql`SELECT (
    pg_total_relation_size('security_events'::regclass) +
    pg_total_relation_size('security_event_reviews'::regclass) +
    pg_total_relation_size('security_retention'::regclass)
  )::float8 AS bytes`);
  const sizeBytes = Number(size.rows[0]?.bytes ?? 0);
  return { ...s, ...counts!, sizeBytes, sizeWarning: sizeBytes >= s.warningSizeMb * 1024 * 1024 };
}

/** Single bounded transaction; serializes policy edits and competing workers.
 * No deletion by size, TRUNCATE, VACUUM FULL or unbounded delete. */
export async function cleanupSecurityEvents(manual = false) {
  await getRetentionSettings();
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(736481, 1) AS acquired`);
    if (!lock.rows[0]?.acquired) {
      if (manual) throw new SecurityCleanupBusyError("Cleanup is already running; try again later");
      return 0;
    }
    await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    const [s] = await tx.select().from(settings).where(eq(settings.id, 1)).for("update");
    if (!s || (!manual && !s.cleanupEnabled)) return 0;
    const expired = await tx.select({ id: events.id }).from(events)
      .where(expiredSecurityEvents(s)).orderBy(events.lastSeenAt, events.id)
      .limit(RETENTION_BATCH_SIZE).for("update", { skipLocked: true });
    const ids = expired.map((row) => row.id);
    if (ids.length) {
      await tx.delete(reviews).where(inArray(reviews.eventId, ids));
      await tx.delete(events).where(inArray(events.id, ids));
    }
    await tx.update(settings).set({
      lastCleanupAt: new Date(), lastDeletedCount: ids.length, lastCleanupError: null,
    }).where(eq(settings.id, 1));
    return ids.length;
  });
}

export async function updateRetentionSettings(
  input: { revision: number; ordinaryDays: number; importantDays: number; warningSizeMb: number; cleanupEnabled: boolean },
  actorUserId: number,
) {
  await getRetentionSettings();
  const [updated] = await db.update(settings).set({
    ordinaryDays: input.ordinaryDays, importantDays: input.importantDays,
    warningSizeMb: input.warningSizeMb, cleanupEnabled: input.cleanupEnabled,
    updatedBy: actorUserId, updatedAt: new Date(), revision: sql`${settings.revision} + 1`,
  }).where(and(eq(settings.id, 1), eq(settings.revision, input.revision))).returning();
  return !!updated;
}

export function startSecurityRetention() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await cleanupSecurityEvents(); }
    catch {
      await recordCleanupFailure();
    } finally { running = false; }
  };
  // No immediate destructive sweep during bootstrap; subsequent runs drain batches.
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function recordCleanupFailure() {
  logger.error("Security retention cleanup failed; evidence was not partially deleted");
  try {
    await db.update(settings).set({ lastCleanupError: "cleanup_failed" }).where(eq(settings.id, 1));
  } catch { /* The primary error is already visible in the independent server log. */ }
}
