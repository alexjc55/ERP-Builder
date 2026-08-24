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
type StreamEntry = { res: Response; canSeeEditing: boolean };

export const PRESENCE_TTL_MS = 45_000;
const rooms = new Map<number, Map<string, Entry>>();
const streams = new Map<number, Map<string, StreamEntry>>();

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

function clean(pageId: number, now = Date.now()): void {
  const room = rooms.get(pageId);
  if (!room) return;
  for (const [key, value] of room) if (value.expiresAt <= now) room.delete(key);
  if (room.size === 0) rooms.delete(pageId);
}

export function presenceSnapshot(pageId: number, canSeeEditing = true): PublicPresence[] {
  clean(pageId);
  return [...(rooms.get(pageId)?.values() ?? [])]
    .sort((a, b) => a.userId - b.userId || a.clientId.localeCompare(b.clientId))
    .map(({ userId, name, color, editing }) => presenceForViewer({ userId, name, color, editing }, canSeeEditing));
}

export function putPresence(pageId: number, clientId: string, user: { id: number; name: string }, editing: Editing | null): void {
  clean(pageId);
  const room = rooms.get(pageId) ?? new Map<string, Entry>();
  rooms.set(pageId, room);
  room.set(clientId, {
    clientId, userId: user.id, name: user.name, color: deterministicPresenceColor(user.id), editing, expiresAt: Date.now() + PRESENCE_TTL_MS,
  });
  broadcastPresence(pageId);
}

export function removePresence(pageId: number, clientId: string): void {
  const room = rooms.get(pageId);
  if (!room || !room.delete(clientId)) return;
  if (room.size === 0) rooms.delete(pageId);
  broadcastPresence(pageId);
}

function write(res: Response, event: string, data: unknown): void {
  if (!res.writableEnded) res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`);
}
export function addStream(pageId: number, clientId: string, res: Response, canSeeEditing: boolean): () => void {
  const room = streams.get(pageId) ?? new Map<string, StreamEntry>();
  streams.set(pageId, room);
  const previous = room.get(clientId);
  if (previous && previous.res !== res && !previous.res.writableEnded) previous.res.end();
  room.set(clientId, { res, canSeeEditing });
  write(res, "snapshot", { presence: presenceSnapshot(pageId, canSeeEditing) });
  const ping = setInterval(() => { if (!res.writableEnded) res.write(":ping\n\n"); }, 20_000);
  return () => {
    clearInterval(ping);
    // A StrictMode remount or fast reconnect can replace this response before
    // the old socket's close callback runs. Never let that stale callback
    // remove the replacement stream or its freshly-published presence.
    if (room.get(clientId)?.res !== res) return;
    room.delete(clientId);
    if (room.size === 0) streams.delete(pageId);
    removePresence(pageId, clientId);
  };
}
export function broadcast(pageId: number, event: string, data: unknown): void {
  for (const { res } of streams.get(pageId)?.values() ?? []) write(res, event, data);
}
function broadcastPresence(pageId: number): void {
  for (const { res, canSeeEditing } of streams.get(pageId)?.values() ?? []) {
    write(res, "presence", { presence: presenceSnapshot(pageId, canSeeEditing) });
  }
}

let bridgeStarted = false;
/** Internal events are intentionally fanned out asynchronously: collaboration
 * must never add latency to a mutation or automation cascade. */
export function initCollaborationBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  subscribe("*", (event) => { void bridge(event); });
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