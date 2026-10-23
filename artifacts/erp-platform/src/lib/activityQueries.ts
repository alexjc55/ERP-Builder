import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Match all page contexts of this entity, without touching unrelated feeds. */
export function isEntityActivityQuery(key: QueryKey, entityId: number): boolean {
  if (key[0] !== "/api/record-activity" && key[0] !== "/api/activity-tasks") return false;
  const params = key[1];
  return !!params && typeof params === "object" && "entityId" in params && params.entityId === entityId;
}

export function invalidateEntityActivity(client: QueryClient, entityId: number) {
  // Inactive feeds become stale; only mounted panels issue a request.
  // Default cancelRefetch prevents an older in-flight response winning.
  return client.invalidateQueries({ predicate: query => isEntityActivityQuery(query.queryKey, entityId) });
}
