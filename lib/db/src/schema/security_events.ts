import { pgTable, serial, text, integer, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

/** Security evidence is append-only through the application. No user FKs: deleting an
 * account must not erase its audit trail. Review state lives in a separate table. */
export const securityEventsTable = pgTable("security_events", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  requestId: text("request_id").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  severity: text("severity").notNull().default("info"),
  isAlert: boolean("is_alert").notNull().default(false),
  actorUserId: integer("actor_user_id"),
  impersonatorUserId: integer("impersonator_user_id"),
  targetUserId: integer("target_user_id"),
  agentId: integer("agent_id"),
  integrationId: integer("integration_id"),
  authSource: text("auth_source").notNull().default("anonymous"),
  sessionRef: text("session_ref"),
  loginEmail: text("login_email"),
  peerIp: text("peer_ip").notNull(),
  clientIp: text("client_ip").notNull(),
  ipSource: text("ip_source").notNull(),
  userAgent: text("user_agent"),
  method: text("method").notNull(),
  route: text("route").notNull(),
  statusCode: integer("status_code"),
  reason: text("reason"),
  detailsJson: jsonb("details_json").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index("security_events_time_idx").on(t.createdAt, t.id),
  index("security_events_request_idx").on(t.requestId),
  index("security_events_session_idx").on(t.sessionRef),
  index("security_events_actor_idx").on(t.actorUserId, t.createdAt),
  index("security_events_login_idx").on(t.loginEmail, t.createdAt),
  index("security_events_alert_idx").on(t.isAlert, t.createdAt),
]);

export const securityEventReviewsTable = pgTable("security_event_reviews", {
  eventId: integer("event_id").primaryKey().references(() => securityEventsTable.id),
  reviewedBy: integer("reviewed_by").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});
