type Evidence = {
  action: string; outcome: string; statusCode?: number | null;
  authSource?: string | null; actorUserId?: number | null;
  sessionRef?: string | null; clientIp?: string | null; peerIp?: string | null;
  ipSource?: string | null; userAgent?: string | null; reason?: string | null;
  method?: string | null; route?: string | null;
};

/** Only the explicit, verified revoked-session boundary, never arbitrary 401s,
 * successful writes, permission denials or unverified token claims. */
export function revokedSessionGroup(row: Evidence): unknown[] | null {
  if (row.action !== "access.denied" || row.outcome !== "denied" ||
      row.statusCode !== 401 || row.authSource !== "revoked-session" ||
      row.reason !== "session_revoked_or_account_inactive" ||
      !row.actorUserId || !row.sessionRef) return null;
  return ["revoked-session-v1", row.actorUserId, row.sessionRef, row.clientIp,
    row.peerIp, row.ipSource, row.userAgent, row.reason];
}

export function addRevokedRequest(
  previous: Record<string, unknown> | null | undefined,
  method: string | null | undefined,
  route: string | null | undefined,
): Record<string, unknown> {
  const requests = [...((previous?.requestSummary as
    { method: string; route: string; count: number }[] | undefined) ?? [])]
    .map((item) => ({ ...item }));
  const request = { method: method ?? "UNKNOWN", route: route ?? "/[unknown]" };
  const match = requests.find((item) => item.method === request.method && item.route === request.route);
  let omitted = Number(previous?.omittedRequestCount ?? 0);
  if (match) match.count++;
  else if (requests.length < 32) requests.push({ ...request, count: 1 });
  else omitted++;
  return {
    ...previous, summaryType: "revoked-session", requestSummary: requests,
    omittedRequestCount: omitted, sourceDetailsTruncated: omitted > 0,
    aggregationWindowMinutes: 5, firstRequestSampleOnly: true,
  };
}
