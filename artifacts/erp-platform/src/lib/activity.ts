// Pure helpers for the activity / tasks module (no React, no aliases: unit-tested
// with `node --experimental-strip-types`).

export type EntryKind = "call" | "email" | "meeting" | "note";
export type TaskKind = "call" | "email" | "meeting" | "task";
export type Outcome = "successful" | "attempted" | "none";
export type TaskFilter = "open" | "today" | "upcoming" | "overdue" | "completed" | "cancelled" | "all";

export const ENTRY_KINDS: readonly EntryKind[] = ["call", "email", "meeting", "note"];
export const TASK_KINDS: readonly TaskKind[] = ["call", "email", "meeting", "task"];
export const OUTCOMES: readonly Outcome[] = ["successful", "attempted", "none"];
export const TASK_FILTERS: readonly TaskFilter[] = ["open", "today", "overdue", "upcoming", "completed", "cancelled", "all"];
/** Reminder presets in minutes before due; null = no reminder. */
export const REMINDER_PRESETS: readonly (number | null)[] = [null, 0, 15, 60, 240, 1440];

/**
 * The server returns a permitted page path with `?recordId=<id>`. The record
 * table deep-link reader understands `?record=<id>`; translate (preserving any
 * other params) so the card opens on arrival. Absolute / foreign URLs are
 * rejected (internal navigation only).
 */
export function recordHref(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  const q = url.indexOf("?");
  if (q < 0) return url;
  const path = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  const rid = params.get("recordId");
  if (rid != null) {
    params.delete("recordId");
    if (!params.has("record")) params.set("record", rid);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** datetime-local value -> ISO timestamp, or null when empty/invalid. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Default due: tomorrow 10:00 local. */
export function defaultDue(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalInput(d);
}

export type DueState = "overdue" | "today" | "upcoming" | "done";
export function dueState(dueAt: string, status: string, now: Date = new Date()): DueState {
  if (status !== "open") return "done";
  const d = new Date(dueAt);
  if (d.getTime() < now.getTime()) return "overdue";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return "today";
  return "upcoming";
}

export interface TaskDraft { title: string; description: string; kind: TaskKind; due: string; assigneeId: string; reminder: string }
export type TaskDraftError = "title" | "due" | "assignee";
/** Validate a task draft; returns the first missing input or null. */
export function taskDraftError(d: TaskDraft): TaskDraftError | null {
  if (!d.title.trim()) return "title";
  if (!fromLocalInput(d.due)) return "due";
  if (!d.assigneeId || !Number.isInteger(Number(d.assigneeId))) return "assignee";
  return null;
}
export function taskDraftToInput(d: TaskDraft, ctx: { entityId: number; recordId: number; pageId?: number | null }) {
  return {
    entityId: ctx.entityId,
    recordId: ctx.recordId,
    ...(ctx.pageId != null ? { pageId: ctx.pageId } : {}),
    title: d.title.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    kind: d.kind,
    dueAt: fromLocalInput(d.due) as string,
    assigneeId: Number(d.assigneeId),
    reminderMinutes: d.reminder === "" ? null : Number(d.reminder),
  };
}

/** Extract a server error message from an Orval/customFetch error. */
export function apiErrorMessage(e: unknown): string {
  const d = (e as { data?: unknown } | null)?.data;
  if (d && typeof d === "object" && "error" in d && typeof (d as { error: unknown }).error === "string") return (d as { error: string }).error;
  return e instanceof Error ? e.message : String(e);
}
export const apiErrorStatus = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;

/** Background refresh so other users' changes appear; local form state is untouched. */
export const ACTIVITY_REFRESH_MS = 30_000;
