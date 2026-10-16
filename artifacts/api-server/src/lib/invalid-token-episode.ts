import { sql } from "drizzle-orm";
import { securityEventsTable as events } from "@workspace/db";
import { addRevokedRequest } from "./revoked-session-summary";

/** Invalid signatures/expired tokens carry NO trusted user identity. */
export function invalidTokenGroup(row: Partial<typeof events.$inferInsert>) {
  if (row.action !== "access.denied" || row.outcome !== "denied" ||
      row.statusCode !== 401 || row.reason !== "invalid_or_expired_token" ||
      row.authSource !== "unverified-token" || !row.sessionRef ||
      row.actorUserId || row.agentId || row.integrationId || row.impersonatorUserId) return null;
  return ["invalid-token-v1", row.sessionRef, row.clientIp, row.peerIp,
    row.ipSource, row.userAgent];
}

export function invalidTokenSummary(
  previous: Record<string, unknown> | null | undefined,
  method: string | null | undefined, route: string | null | undefined,
) {
  const { aggregationWindowMinutes: _, ...summary } = addRevokedRequest(previous, method, route);
  return { ...summary, summaryType: "invalid-token-episode", identityVerified: false };
}

// Acknowledgment covers this exact token/source episode. Other events still
// reopen on new occurrences. Never infer a user from unverified token claims.
export const invalidTokenEpisodeSql = sql<boolean>`coalesce((
  ${events.action} = 'access.denied' AND ${events.outcome} = 'denied'
  AND ${events.statusCode} = 401 AND ${events.reason} = 'invalid_or_expired_token'
  AND ${events.authSource} = 'unverified-token' AND ${events.actorUserId} IS NULL
  AND ${events.detailsJson}->>'summaryType' = 'invalid-token-episode'
), false)`;
