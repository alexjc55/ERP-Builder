import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type LatestActivity = { kind: string; occurredAt: string; statusNameJson?: Record<string, string> };
export function chooseLatestActivity(
  statusChangedAt: Date | string | null,
  activity: LatestActivity | null,
): LatestActivity | null {
  if (!statusChangedAt) return activity;
  const statusTime = new Date(statusChangedAt).toISOString();
  return !activity || Date.parse(statusTime) > Date.parse(activity.occurredAt)
    ? { kind: "status_changed", occurredAt: statusTime } : activity;
}

/**
 * Enrich already permission-filtered responses, never the stored values.
 * One batched query, with indexed per-record lookups; no text, actors or
 * historical status names are exposed. Current status belongs to the already
 * permission-filtered record. Missing/hidden fields stay absent.
 */
export async function withLatestActivity<T extends { id: number; valuesJson: unknown }>(
  records: T[], fields: { fieldType: string; fieldKey: string }[],
): Promise<T[]> {
  const keys = fields.filter(f => f.fieldType === "activity").map(f => f.fieldKey);
  const visible = records.filter(r => keys.some(k => Object.hasOwn((r.valuesJson ?? {}) as object, k)));
  if (!keys.length || !visible.length) return records;
  const result = await db.execute(sql`
    SELECT r.id, r.status_changed_at, s.name_json AS status_name_json, a.kind, a.occurred_at
    FROM entity_records r
    LEFT JOIN entity_statuses s ON s.id = r.status_id AND s.entity_id = r.entity_id
    LEFT JOIN LATERAL (
      SELECT a.kind, a.occurred_at
      FROM record_activity a
      JOIN activity_settings cfg ON cfg.entity_id = a.entity_id AND cfg.enabled
      WHERE a.record_id = r.id AND NOT a.deleted
        AND a.kind IN ('call', 'email', 'meeting', 'note',
                       'task_created', 'task_completed', 'task_rescheduled', 'task_cancelled')
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1
    ) a ON true
    WHERE r.id IN (${sql.join(visible.map(r => sql`${r.id}`), sql`, `)})
  `);
  const values = new Map<number, LatestActivity | null>();
  for (const row of result.rows) {
    const latest = chooseLatestActivity(
      row.status_changed_at as Date | string | null,
      row.kind ? { kind: String(row.kind), occurredAt: new Date(row.occurred_at as string).toISOString() } : null,
    );
    if (latest?.kind === "status_changed" && row.status_name_json) latest.statusNameJson = row.status_name_json as Record<string, string>;
    values.set(Number(row.id), latest);
  }
  return records.map(record => {
    const next = { ...((record.valuesJson ?? {}) as Record<string, unknown>) };
    for (const key of keys) if (Object.hasOwn(next, key)) next[key] = values.get(record.id) ?? null;
    return { ...record, valuesJson: next };
  });
}
