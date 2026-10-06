import { createHmac, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, securityEventsTable } from "@workspace/db";
import { APP_SECRET } from "./secret";
import { logger } from "./logger";
import { securityRequestIp } from "./security-ip";

type Evidence = {
  requestId: string; action: string; route: string; critical: boolean;
  actorUserId?: number; impersonatorUserId?: number; targetUserId?: number;
  agentId?: number; integrationId?: number; authSource?: string;
  sessionRef?: string; reason?: string; details: Record<string, unknown>;
  started?: boolean;
};
declare global {
  namespace Express { interface Request { securityEvidence?: Evidence } }
}
export const securityTokenRef = (token: string) =>
  createHmac("sha256", APP_SECRET).update("security-session\0").update(token).digest("hex");
const int = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value) ? value as Record<string, unknown> : {};

/** Never store arbitrary paths, query strings or request/response bodies. */
export function classifySecurityRequest(path: string, method: string) {
  const route = path.replace(/^\/api(?=\/)/, "");
  const write = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (/^\/auth\/(login|change-password|revoke-sessions|revoke-all-sessions|impersonate|stop-impersonation)$/.test(route) && write) {
    return { action: `auth.${route.split("/").pop()}`, route, critical: true };
  }
  if (route === "/auth/me" && write) return { action: "user.profile-update", route, critical: true };
  if (route === "/guest/redeem" && write) return { action: "guest.redeem", route, critical: true };
  if (/^\/webhooks\/inbound\/\d+$/.test(route)) return { action: "inbound.receive", route: "/webhooks/inbound/:integrationId", critical: true };
  if (/^\/fields\/\d+\/users$/.test(route) && write) return { action: "user.create-from-field", route: "/fields/:fieldId/users", critical: true };
  if (/^\/users(?:\/\d+)?(?:\/(?:reset-password|block|unblock|guest-links))?$/.test(route) && write) {
    const suffix = route.split("/")[3];
    return { action: `user.${suffix ?? (method === "POST" ? "create" : method === "DELETE" ? "delete" : "update")}`,
      route: route.replace(/\/\d+/g, "/:userId"), critical: true };
  }
  if (route === "/users/merge" && write) return { action: "user.merge", route, critical: true };
  if (/^\/guest-links\/\d+\/revoke$/.test(route) && write) return { action: "guest.revoke", route: "/guest-links/:id/revoke", critical: true };
  for (const [prefix, action] of [["roles", "role"], ["ai-agents", "agent"], ["inbound-integrations", "integration"], ["google-drive", "drive"], ["modules", "module"]] as const) {
    // Restrict the remaining path to known static words and numeric IDs; no attacker strings.
    if (route === `/${prefix}` || route.startsWith(`/${prefix}/`)) {
      const suffix = route.slice(prefix.length + 1);
      const safe = suffix.split("/").filter(Boolean).every((part) => /^\d+$/.test(part) ||
        ["regenerate-key", "regenerate-secret", "mappings", "rotate-key", "rotate-token", "connection", "oauth", "start", "callback", "disconnect", "check",
          "folders", "toggle", "mapping", "draft", "publish", "preview", "retry", "deliveries", "reprocess", "acknowledge", "review", "versions", "test"].includes(part));
      const oauthCallback = route === "/google-drive/oauth/callback";
      if ((write || oauthCallback) && safe) return {
        action: `${action}.${oauthCallback ? "oauth-callback" : method.toLowerCase()}`,
        route: route.replace(/\/\d+/g, "/:id"), critical: true,
      };
    }
  }
  return { action: "access.denied", route: "/[protected-or-unmatched-route]", critical: false };
}

export function securityReason(req: Request, reason: string) {
  if (req.securityEvidence) req.securityEvidence.reason = reason;
}
export function securityVerifiedIdentity(req: Request, identity: {
  userId: number; agentId?: number; impersonatorId?: number; guest?: boolean;
}, source?: string) {
  const e = req.securityEvidence;
  if (!e) return;
  e.actorUserId = identity.userId;
  e.impersonatorUserId = identity.impersonatorId;
  e.agentId = identity.agentId;
  e.authSource = source ?? (identity.agentId ? "agent" : identity.guest ? "guest" : identity.impersonatorId ? "impersonation" : "session");
  if (["auth.change-password", "auth.revoke-sessions", "user.profile-update"].includes(e.action)) {
    e.targetUserId = identity.userId;
  }
}

function requestDetails(req: Request) {
  const body = object(req.body);
  const details: Record<string, unknown> = {};
  // Keys and booleans only for secrets/configuration. Never log their values.
  const keys = ["email", "password", "currentPassword", "newPassword", "roleId", "roleIds", "isActive",
    "permissionsJson", "userId", "accountUserId", "mask", "keyMode", "ownClientId", "ownClientSecret", "folderAction",
    "isEnabled", "mappingJson", "name", "firstName", "lastName", "sourceIds", "targetId"];
  details.requestedChanges = keys.filter((key) => Object.hasOwn(body, key));
  if (int(body.roleId)) details.requestedRoleId = body.roleId;
  if (Array.isArray(body.roleIds)) details.requestedRoleIds = body.roleIds.filter((v) => int(v)).slice(0, 100);
  if (typeof body.isActive === "boolean") details.requestedActive = body.isActive;
  if (typeof body.isEnabled === "boolean") details.requestedEnabled = body.isEnabled;
  const permissions = object(body.permissionsJson);
  if (typeof permissions.superAdmin === "boolean") details.requestedSuperAdmin = permissions.superAdmin;
  if (Object.hasOwn(body, "permissionsJson")) {
    const admins = object(permissions.admin);
    const allowed = ["users", "roles", "pages", "entities", "fields", "statuses", "transitions", "automations",
      "modules", "events", "translations", "dataImport", "googleDrive", "inboundIntegrations", "documents", "cardTemplates"];
    details.requestedAdminCapabilities = Object.fromEntries(allowed.filter((key) => typeof admins[key] === "boolean").map((key) => [key, admins[key]]));
  }
  if (["keep", "forget"].includes(String(body.folderAction))) details.folderAction = body.folderAction;
  if (["builtin", "own"].includes(String(body.keyMode))) details.requestedKeyMode = body.keyMode;
  if (Array.isArray(body.sourceIds)) details.sourceUserIds = body.sourceIds.filter((v) => int(v)).slice(0, 100);
  if (int(body.targetId)) details.targetUserId = body.targetId;
  return details;
}

function captureResult(req: Request, body: unknown) {
  const e = req.securityEvidence;
  if (!e) return;
  const data = object(body);
  // Only known response slots from known actions are interpreted as credentials.
  if (e.action === "auth.login" && req.res!.statusCode < 400) {
    const user = object(data.user);
    if (int(user.id)) { e.actorUserId = int(user.id); e.authSource = "password"; }
  }
  if (e.action === "guest.redeem" && req.res!.statusCode < 400) {
    const user = object(data.user);
    if (int(user.id)) { e.actorUserId = int(user.id); e.authSource = "guest"; }
  }
  if (e.route === "/google-drive/oauth/start" && typeof data.authUrl === "string") {
    try {
      const state = new URL(data.authUrl).searchParams.get("state");
      if (state) e.details.issuedOAuthStateRef = securityTokenRef(state);
    } catch { /* Do not retain a malformed provider URL. */ }
  }
  if (/^auth\.(login|impersonate|stop-impersonation)$/.test(e.action) || e.action === "guest.redeem") {
    if (typeof data.token === "string" && req.res!.statusCode < 400) {
      const ref = securityTokenRef(data.token);
      e.details.issuedSessionRef = ref;
      if (e.action === "auth.login" || e.action === "guest.redeem") e.sessionRef = ref;
    }
  }
  if (e.action.startsWith("user.") && int(data.id)) e.targetUserId = int(data.id);
  if (e.action === "inbound.receive" && int(data.deliveryId)) {
    e.details.deliveryId = data.deliveryId;
    e.details.stage = "intake"; // HTTP 202 is not evidence of successful data processing.
  }
  if (["role.", "agent.", "integration."].some((prefix) => e.action.startsWith(prefix)) && int(data.id)) {
    e.details.resultId = data.id;
  }
}

const pending = new Set<Promise<unknown>>();
/** Tests and orderly shutdown may wait for already started outcome appends. */
export async function flushSecurityAudit() { await Promise.allSettled([...pending]); }

async function append(req: Request, outcome: string, statusCode?: number) {
  const e = req.securityEvidence!;
  const isFailure = ["denied", "failure"].includes(outcome);
  const login = e.action === "auth.login";
  const rawEmail = object(req.body).email;
  const loginEmail = login && typeof rawEmail === "string" && rawEmail.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail.toLowerCase() : null;
  let repeatedLoginFailure = false;
  if (login && (isFailure || outcome === "success") && loginEmail) {
    const [recent] = await db.select({ count: sql<number>`count(*)::int` }).from(securityEventsTable).where(and(
      eq(securityEventsTable.action, "auth.login"), eq(securityEventsTable.loginEmail, loginEmail),
      eq(securityEventsTable.outcome, "denied"), gte(securityEventsTable.createdAt, new Date(Date.now() - 10 * 60_000)),
    )).catch(() => {
      logger.error({ requestId: e.requestId, action: e.action, outcome, statusCode }, "Security audit classification failed; outcome not persisted");
      throw new Error("Security audit unavailable");
    });
    repeatedLoginFailure = (recent?.count ?? 0) >= 4;
  }
  // Critical successful changes alert regardless of whether the caller considers them routine.
  const criticalSuccess = outcome === "success" && e.critical &&
    !["auth.login", "guest.redeem", "inbound.receive", "drive.post"].includes(e.action);
  const credentialChange = outcome === "success" && e.action === "drive.post" && !e.route.endsWith("/check");
  const isAlert = criticalSuccess || credentialChange || repeatedLoginFailure ||
    (outcome === "denied" && e.route !== "/auth/me" && !["auth.login", "guest.redeem"].includes(e.action));
  const row = {
    requestId: e.requestId, action: e.action, outcome,
    severity: isAlert ? (criticalSuccess || credentialChange ? "critical" : "warning") : "info", isAlert,
    actorUserId: e.actorUserId, impersonatorUserId: e.impersonatorUserId,
    targetUserId: e.targetUserId, agentId: e.agentId, integrationId: e.integrationId,
    authSource: e.authSource ?? "anonymous", sessionRef: e.sessionRef, loginEmail,
    ...securityRequestIp(req),
    // Keep a coarse browser signature, not arbitrary user-agent text.
    userAgent: /Firefox|Edg|Chrome|Safari|curl|python-requests/i.exec(req.header("user-agent") ?? "")?.[0] ?? "other",
    method: req.method, route: e.route, statusCode,
    reason: statusCode && statusCode >= 500 ? "server_error" : e.reason,
    detailsJson: { ...requestDetails(req), ...e.details },
  };
  try {
    await db.insert(securityEventsTable).values(row);
  } catch {
    // Independent structured evidence survives a database failure if server logs are retained.
    logger.error({ securityEvent: row }, "Security audit persistence failed");
    throw new Error("Security audit unavailable");
  }
}

/** Install before parsers so malformed requests and auth failures are observable. */
export function securityAuditContext(req: Request, res: Response, next: NextFunction) {
  const classification = classifySecurityRequest(req.path, req.method);
  const requestId = typeof req.id === "string" && /^[a-f0-9-]{36}$/i.test(req.id) ? req.id : randomUUID();
  req.securityEvidence = { ...classification, requestId, details: {} };
  const e = req.securityEvidence;
  res.setHeader("X-Request-Id", e.requestId);
  const bearer = req.header("authorization");
  if (bearer?.startsWith("Bearer ")) {
    e.sessionRef = securityTokenRef(bearer.slice(7));
    // An unauthenticated token's claimed identity is never trusted or decoded.
    e.authSource = "unverified-token";
  }
  const target = /^\/(?:api\/)?users\/(\d+)/.exec(req.path);
  if (target) e.targetUserId = int(Number(target[1]));
  const resource = /^\/(?:api\/)?(roles|ai-agents|inbound-integrations|modules|guest-links)\/(\d+)/.exec(req.path);
  if (resource) {
    const names: Record<string, string> = {
      roles: "targetRoleId", "ai-agents": "targetAgentId",
      "inbound-integrations": "targetIntegrationId", modules: "targetModuleId", "guest-links": "targetGuestLinkId",
    };
    e.details[names[resource[1]!]!] = int(Number(resource[2]));
  }
  const integration = /^\/(?:api\/)?webhooks\/inbound\/(\d+)/.exec(req.path);
  if (integration) e.integrationId = int(Number(integration[1]));
  const json = res.json;
  res.json = function (body: unknown) { captureResult(req, body); return json.call(this, body); };
  let finished = false;
  const finish = (interrupted: boolean) => {
    if (finished) return;
    finished = true;
    const status = res.statusCode;
    if (!e.critical && ![401, 403, 404].includes(status)) return;
    // Route patterns are application-owned, not raw user paths.
    if (!e.critical && typeof req.route?.path === "string") e.route = req.route.path;
    let outcome = interrupted ? "interrupted" : status >= 400 ? ([401, 403].includes(status) ? "denied" : "failure") : "success";
    if (e.action === "drive.oauth-callback") {
      const location = res.getHeader("location");
      if (typeof location !== "string" || !location.endsWith("drive=connected")) outcome = "failure";
    }
    const job = append(req, outcome, interrupted ? undefined : status).catch(() => {});
    pending.add(job); void job.finally(() => pending.delete(job));
  };
  res.once("finish", () => finish(false));
  res.once("close", () => { if (!res.writableFinished) finish(true); });
  next();
}

/** A persisted attempt is required before executing a critical HTTP operation.
 * It remains visible if the process dies before the separate outcome append. */
export async function securityAuditStart(req: Request, res: Response, next: NextFunction) {
  const e = req.securityEvidence;
  if (!e?.critical || e.started) { next(); return; }
  e.started = true;
  if (e.action === "auth.impersonate") e.targetUserId = int(object(req.body).userId);
  try { await append(req, "attempt"); next(); }
  catch { res.status(503).json({ error: "Security audit unavailable; operation not started" }); }
}
