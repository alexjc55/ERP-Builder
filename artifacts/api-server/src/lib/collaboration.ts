import type { Response } from "express";
import { db, entitiesTable, pagesTable, type SystemEvent } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import {
  EVENT_PAGE_FIELD_SAVED,
  EVENT_RECORD_CREATED,
  EVENT_RECORD_DELETED,
  EVENT_RECORD_UPDATED,
  EVENT_STATUS_CHANGED,
  subscribe,
} from "./events";
import { logger } from "./logger";

export type Editing = { entityId: number; recordId: number; fieldKey: string; source: "entity" | "page" };
export type PublicPresence = { userId: number; name: string; color: string; editing: Editing | null };
type Entry = PublicPresence & { clientId: string; expiresAt: number };
type GlobalEntry = {
  userId: number;
  name: string;
  color: string;
  clientId: string;
  pageId: number;
  lastActiveAt: number;
  activityOrder: number;
  expiresAt: number;
};
export type GlobalUserPresence = {
  userId: number;
  name: string;
  color: string;
  currentPageId: number;
  lastActiveAt: number;
  sessionCount: number;
};
type StreamEntry = {
  res: Response;
  canSeeEditing: boolean;
  userId?: number;
  ping?: ReturnType<typeof setInterval>;
};

export const PRESENCE_TTL_MS = 45_000;
const PRESENCE_CLEANUP_INTERVAL_MS = 5_000;
const rooms = new Map<number, Map<string, Entry>>();
// Ephemeral process-local registry. A user/client pair represents one browser
// tab and is independent of page rooms so the dashboard can aggregate globally.
const globalPresence = new Map<string, GlobalEntry>();
let globalActivityOrder = 0;
const streams = new Map<number, Map<string, StreamEntry>>();
let presenceCleanupTimer: ReturnType<typeof setInterval> | undefined;
let stopBridge: (() => void) | undefined;

export function deterministicPresenceColor(userId: number): string {
  const palette = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#4f46e5", "#ca8a04"];
  return palette[Math.abs(userId) % palette.length]!;
}

/** Pure privacy boundary used for every recipient-specific presence snapshot. */
export function presenceForViewer(presence: PublicPresence, canSeeEditing: boolean): PublicPresence {
  return { ...presence, editing: canSeeEditing ? presence.editing : null };
}

export function isUnrestrictedVisibilityProfile(profile: {
  scope: "all" | "own" | "filter";
  hiddenRowStatusCount: number;
  visibleEntityFieldCount: number;
  activeEntityFieldCount: number;
  visiblePageFieldCount: number;
  activePageFieldCount: number;
}): boolean {
  return profile.scope === "all" &&
    profile.hiddenRowStatusCount === 0 &&
    profile.visibleEntityFieldCount === profile.activeEntityFieldCount &&
    profile.visiblePageFieldCount === profile.activePageFieldCount;
}

function clean(pageId: number, now = Date.now()): boolean {
  const room = rooms.get(pageId);
  if (!room) return false;
  let changed = false;
  for (const [key, value] of room) {
    if (value.expiresAt <= now) {
      room.delete(key);
      changed = true;
    }
  }
  if (room.size === 0) rooms.delete(pageId);
  stopPresenceCleanupIfIdle();
  return changed;
}

function globalKey(userId: number, clientId: string): string {
  return `${userId}:${clientId}`;
}

function cleanGlobal(now = Date.now()): boolean {
  let changed = false;
  for (const [key, value] of globalPresence) {
    if (value.expiresAt <= now) {
      globalPresence.delete(key);
      changed = true;
    }
  }
  stopPresenceCleanupIfIdle();
  return changed;
}

function cleanAllPresence(now = Date.now()): number[] {
  const changedPages: number[] = [];
  for (const [pageId, room] of rooms) {
    let changed = false;
    for (const [key, value] of room) {
      if (value.expiresAt <= now) {
        room.delete(key);
        changed = true;
      }
    }
    if (room.size === 0) rooms.delete(pageId);
    if (changed) changedPages.push(pageId);
  }
  cleanGlobal(now);
  stopPresenceCleanupIfIdle();
  return changedPages;
}

function ensurePresenceCleanup(): void {
  if (presenceCleanupTimer) return;
  presenceCleanupTimer = setInterval(() => {
    for (const pageId of cleanAllPresence()) broadcastPresence(pageId);
  }, PRESENCE_CLEANUP_INTERVAL_MS);
  presenceCleanupTimer.unref?.();
}

function stopPresenceCleanupIfIdle(): void {
  if (presenceCleanupTimer && rooms.size === 0 && globalPresence.size === 0) {
    clearInterval(presenceCleanupTimer);
    presenceCleanupTimer = undefined;
  }
}

/** Safe global snapshot aggregated by user across active browser tabs. */
export function globalPresenceSnapshot(now = Date.now()): GlobalUserPresence[] {
  cleanGlobal(now);
  const users = new Map<number, GlobalUserPresence & { activityOrder: number }>();
  for (const session of globalPresence.values()) {
    const current = users.get(session.userId);
    if (!current) {
      users.set(session.userId, {
        userId: session.userId,
        name: session.name,
        color: session.color,
        currentPageId: session.pageId,
        lastActiveAt: session.lastActiveAt,
        sessionCount: 1,
        activityOrder: session.activityOrder,
      });
      continue;
    }
    current.sessionCount += 1;
    if (session.activityOrder > current.activityOrder) {
      current.name = session.name;
      current.currentPageId = session.pageId;
      current.lastActiveAt = session.lastActiveAt;
      current.activityOrder = session.activityOrder;
    }
  }
  return [...users.values()]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt || b.activityOrder - a.activityOrder || a.userId - b.userId)
    .map(({ activityOrder: _activityOrder, ...user }) => user);
}

export function presenceSnapshot(pageId: number, canSeeEditing = true): PublicPresence[] {
  clean(pageId);
  return [...(rooms.get(pageId)?.values() ?? [])]
    .sort((a, b) => a.userId - b.userId || a.clientId.localeCompare(b.clientId))
    .map(({ userId, name, color, editing }) => presenceForViewer({ userId, name, color, editing }, canSeeEditing));
}

export function putPresence(pageId: number, clientId: string, user: { id: number; name: string }, editing: Editing | null): void {
  clean(pageId);
  cleanGlobal();
  const now = Date.now();
  const room = rooms.get(pageId) ?? new Map<string, Entry>();
  rooms.set(pageId, room);
  room.set(clientId, {
    clientId, userId: user.id, name: user.name, color: deterministicPresenceColor(user.id), editing, expiresAt: now + PRESENCE_TTL_MS,
  });
  globalPresence.set(globalKey(user.id, clientId), {
    clientId,
    userId: user.id,
    name: user.name,
    color: deterministicPresenceColor(user.id),
    pageId,
    lastActiveAt: now,
    activityOrder: ++globalActivityOrder,
    expiresAt: now + PRESENCE_TTL_MS,
  });
  ensurePresenceCleanup();
  broadcastPresence(pageId);
}

export function removePresence(pageId: number, clientId: string, userId?: number): void {
  if (userId != null) {
    const entry = globalPresence.get(globalKey(userId, clientId));
    if (entry?.pageId === pageId) globalPresence.delete(globalKey(userId, clientId));
  }
  const room = rooms.get(pageId);
  if (!room || !room.delete(clientId)) {
    stopPresenceCleanupIfIdle();
    return;
  }
  if (room.size === 0) rooms.delete(pageId);
  stopPresenceCleanupIfIdle();
  broadcastPresence(pageId);
}

function closeStream(pageId: number, clientId: string, stream: StreamEntry, removeClientPresence: boolean): void {
  stream.ping && clearInterval(stream.ping);
  stream.ping = undefined;
  const room = streams.get(pageId);
  // Generation check: a late close from a replaced socket cannot remove the
  // new stream or its presence.
  if (room?.get(clientId) !== stream) return;
  room.delete(clientId);
  if (room.size === 0) streams.delete(pageId);
  if (removeClientPresence) removePresence(pageId, clientId, stream.userId);
  if (!stream.res.writableEnded) stream.res.end();
}

function writeStream(pageId: number, clientId: string, stream: StreamEntry, frame: string): void {
  if (stream.res.writableEnded) {
    closeStream(pageId, clientId, stream, true);
    return;
  }
  try {
    // A false result means the HTTP response's finite high-water buffer is
    // full. SSE reconnects receive a snapshot, so close rather than queueing
    // an unbounded per-client backlog.
    if (!stream.res.write(frame)) closeStream(pageId, clientId, stream, true);
  } catch {
    closeStream(pageId, clientId, stream, true);
  }
}

function writeEvent(pageId: number, clientId: string, stream: StreamEntry, event: string, data: unknown): void {
  writeStream(pageId, clientId, stream, `event:${event}\ndata:${JSON.stringify(data)}\n\n`);
}
export function addStream(pageId: number, clientId: string, res: Response, canSeeEditing: boolean, userId?: number): () => void {
  const room = streams.get(pageId) ?? new Map<string, StreamEntry>();
  streams.set(pageId, room);
  const previous = room.get(clientId);
  if (previous && previous.res !== res) closeStream(pageId, clientId, previous, false);
  const activeRoom = streams.get(pageId) ?? new Map<string, StreamEntry>();
  streams.set(pageId, activeRoom);
  const stream: StreamEntry = { res, canSeeEditing, userId };
  activeRoom.set(clientId, stream);
  writeEvent(pageId, clientId, stream, "snapshot", { presence: presenceSnapshot(pageId, canSeeEditing) });
  if (activeRoom.get(clientId) === stream) {
    stream.ping = setInterval(() => writeStream(pageId, clientId, stream, ":ping\n\n"), 20_000);
    stream.ping.unref?.();
  }
  return () => closeStream(pageId, clientId, stream, true);
}

export function broadcast(pageId: number, event: string, data: unknown): void {
  for (const [clientId, stream] of [...(streams.get(pageId) ?? [])]) {
    writeEvent(pageId, clientId, stream, event, data);
  }
}
function broadcastPresence(pageId: number): void {
  for (const [clientId, stream] of [...(streams.get(pageId) ?? [])]) {
    writeEvent(pageId, clientId, stream, "presence", { presence: presenceSnapshot(pageId, stream.canSeeEditing) });
  }
}

let bridgeStarted = false;
/**
 * Release process-local collaboration resources. The application entrypoint
 * owns this during graceful shutdown; it is safe to invoke more than once.
 */
export function disposeCollaboration(): void {
  if (presenceCleanupTimer) {
    clearInterval(presenceCleanupTimer);
    presenceCleanupTimer = undefined;
  }
  for (const room of streams.values()) {
    for (const stream of room.values()) {
      if (stream.ping) clearInterval(stream.ping);
      stream.ping = undefined;
      try {
        if (!stream.res.writableEnded) stream.res.end();
      } catch (err) {
        // A broken response must not prevent the remaining streams and
        // process-local registries from being released.
        logger.error({ err }, "Failed to close collaboration stream during shutdown");
      }
    }
  }
  streams.clear();
  rooms.clear();
  globalPresence.clear();
  globalActivityOrder = 0;
  stopBridge?.();
  stopBridge = undefined;
  bridgeStarted = false;
}

/** Internal events are intentionally fanned out asynchronously: collaboration
 * must never add latency to a mutation or automation cascade. */
export function initCollaborationBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  stopBridge = subscribe("*", (event) => { void bridge(event); });
}
async function bridge(event: SystemEvent): Promise<void> {
  try {
    const payload = (event.payloadJson ?? {}) as Record<string, unknown>;
    if (event.eventName === EVENT_PAGE_FIELD_SAVED && typeof payload.pageId === "number") {
      broadcast(payload.pageId, "table_changed", {});
      return;
    }
    if (![EVENT_RECORD_CREATED, EVENT_RECORD_UPDATED, EVENT_RECORD_DELETED, EVENT_STATUS_CHANGED].includes(event.eventName) || event.entityId == null) return;
    const pages = await db.select({ id: pagesTable.id }).from(pagesTable)
      .leftJoin(entitiesTable, eq(entitiesTable.pageId, pagesTable.id))
      .where(or(eq(entitiesTable.id, event.entityId), eq(pagesTable.mirrorEntityId, event.entityId)));
    for (const page of pages) broadcast(page.id, "table_changed", {});
  } catch (err) {
    logger.error({ err }, "Collaboration event bridge failed");
  }
}