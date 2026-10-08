import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

// One atomic reservation, shared across workers and preserved across restarts.
// Fixed hashed slots bound storage even when attackers invent arbitrary emails.
const SLOTS = 65536;
export function loginThrottleSlot(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0) % SLOTS;
}
export async function reserveLoginAttempt(ip: string, email: string): Promise<number> {
  const rules = [
    { key: `ip:${loginThrottleSlot(ip)}`, max: 30, seconds: 60 },
    { key: `pair:${loginThrottleSlot(`${ip}\0${email.trim().toLowerCase()}`)}`, max: 8, seconds: 900 },
    // Distributed attempts are capped per account, but the account is never disabled.
    { key: `account:${loginThrottleSlot(email.trim().toLowerCase())}`, max: 40, seconds: 900 },
    { key: "global", max: 300, seconds: 60 },
  ].sort((a, b) => a.key.localeCompare(b.key));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    let retry = 0;
    for (const rule of rules) {
      const result = await client.query<{ hits: number; retry: number }>(`
        INSERT INTO login_throttle (bucket, hits, expires_at)
        VALUES ($1, 1, clock_timestamp() + $2 * interval '1 second')
        ON CONFLICT (bucket) DO UPDATE SET
          hits = CASE WHEN login_throttle.expires_at <= clock_timestamp() THEN 1
            ELSE LEAST(login_throttle.hits + 1, $3 + 1) END,
          expires_at = CASE WHEN login_throttle.expires_at <= clock_timestamp()
            THEN clock_timestamp() + $2 * interval '1 second' ELSE login_throttle.expires_at END
        RETURNING hits, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - clock_timestamp())))::int AS retry
      `, [rule.key, rule.seconds, rule.max]);
      if (result.rows[0]!.hits > rule.max) retry = Math.max(retry, result.rows[0]!.retry);
    }
    await client.query("COMMIT");
    return retry;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
