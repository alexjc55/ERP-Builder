import { db, systemEventsTable, type SystemEvent } from "@workspace/db";

/**
 * Stage 14 — Event System.
 *
 * A lightweight internal event bus: every emitted event is persisted to the
 * `system_events` table (the durable log) AND dispatched to in-process
 * subscribers. This is the foundation for future automations / modules
 * (Stage 15) which can subscribe without touching the call sites that emit.
 *
 * Emission is best-effort: like the audit log, it must never break the
 * underlying data mutation, so both the persist and every subscriber are
 * isolated in try/catch.
 */

export const EVENT_RECORD_CREATED = "record.created";
export const EVENT_RECORD_UPDATED = "record.updated";
export const EVENT_RECORD_DELETED = "record.deleted";
export const EVENT_STATUS_CHANGED = "status.changed";
export const EVENT_USER_CREATED = "user.created";
/** A page-local field value was saved (changed) for a record on a mirror page. */
export const EVENT_PAGE_FIELD_SAVED = "page_field.saved";

/** Wildcard subscription key — receives every event. */
export const EVENT_ANY = "*";

/** An event to emit onto the bus (before it is persisted/timestamped). */
export interface EventInput {
  eventName: string;
  entityId?: number | null;
  recordId?: number | null;
  payload?: Record<string, unknown>;
}

export type EventHandler = (event: SystemEvent) => void | Promise<void>;

type Logger = { error: (obj: unknown, msg?: string) => void };

const subscribers = new Map<string, Set<EventHandler>>();

/**
 * Subscribe a handler to an event name (or {@link EVENT_ANY} for all events).
 * Returns an unsubscribe function. Handlers run after the event is persisted;
 * a throwing handler is isolated and never affects the emitter or its peers.
 */
export function subscribe(eventName: string, handler: EventHandler): () => void {
  let set = subscribers.get(eventName);
  if (!set) {
    set = new Set();
    subscribers.set(eventName, set);
  }
  set.add(handler);
  return () => {
    subscribers.get(eventName)?.delete(handler);
  };
}

async function dispatch(event: SystemEvent, log?: Logger): Promise<void> {
  const handlers = [
    ...(subscribers.get(event.eventName) ?? []),
    ...(subscribers.get(EVENT_ANY) ?? []),
  ];
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (err) {
      log?.error({ err, eventName: event.eventName }, "Event subscriber failed");
    }
  }
}

/**
 * Emit one or more events onto the bus. Persists them to `system_events`
 * (best-effort) and then dispatches the persisted rows to subscribers.
 */
export async function emitEvent(events: EventInput | EventInput[], log?: Logger): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;

  let rows: SystemEvent[] = [];
  try {
    rows = await db
      .insert(systemEventsTable)
      .values(
        list.map((e) => ({
          eventName: e.eventName,
          entityId: e.entityId ?? null,
          recordId: e.recordId ?? null,
          payloadJson: e.payload ?? {},
        })),
      )
      .returning();
  } catch (err) {
    log?.error({ err }, "Failed to persist system events");
    return;
  }

  for (const row of rows) {
    await dispatch(row, log);
  }
}
