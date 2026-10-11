import { sql } from "drizzle-orm";
import { securityEventsTable as events } from "@workspace/db";

type Event = Partial<typeof events.$inferInsert>;

/** A denied optional metadata read is evidence, not by itself a security incident.
 * Never apply this to unauthenticated callers, agents, impersonation or writes. */
export function isOptionalFilterDenial(e: Event): boolean {
  return e.action === "access.denied" && e.outcome === "denied" &&
    e.statusCode === 403 && e.method === "GET" &&
    e.route === "/entities/:entityId/custom-filters" &&
    e.authSource === "session" && !!e.actorUserId &&
    !e.agentId && !e.integrationId && !e.impersonatorUserId &&
    e.reason == null;
}

// Same policy for historical rows: no deletion and no fabricated review/actor.
export const optionalFilterDenialSql = sql<boolean>`coalesce((
  ${events.action} = 'access.denied' AND ${events.outcome} = 'denied'
  AND ${events.statusCode} = 403 AND ${events.method} = 'GET'
  AND ${events.route} = '/entities/:entityId/custom-filters'
  AND ${events.authSource} = 'session' AND ${events.actorUserId} IS NOT NULL
  AND ${events.agentId} IS NULL AND ${events.integrationId} IS NULL
  AND ${events.impersonatorUserId} IS NULL AND ${events.reason} IS NULL
), false)`;
export const actionableAlertSql = sql<boolean>`(${events.isAlert} AND NOT ${optionalFilterDenialSql})`;

export function classifyDisplayedEvidence<T extends Event>(event: T): T {
  if (!isOptionalFilterDenial(event)) return event;
  return {
    ...event, isAlert: false, severity: "info",
    detailsJson: {
      ...event.detailsJson,
      alertClassification: "Информационное событие: отказ в чтении необязательного списка фильтров. Доступ не предоставлен. Сам по себе этот запрос не требует ручной проверки.",
    },
  };
}
