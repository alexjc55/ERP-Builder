import { inArray, sql } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import type { DbExecutor } from "../routes/records";

// Dedicated two-int advisory-lock namespace; the second key is users.id.
export const USER_REFERENCE_LOCK_NS = 0x55535246;

export class UserReferenceBusyError extends Error {
  readonly status = 409;
  constructor() {
    super("User references are being merged; retry");
  }
}

export function referencedUserIds(
  fields: { fieldKey: string; fieldType: string }[],
  values: Record<string, unknown>,
): number[] {
  const ids: number[] = [];
  for (const field of fields) {
    if (field.fieldType !== "user") continue;
    const value = values[field.fieldKey];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "number" && Number.isInteger(item)) ids.push(item);
    }
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

export async function lockAndValidateUserReferences(
  tx: DbExecutor,
  ids: number[],
): Promise<string | null> {
  for (const userId of [...new Set(ids)].sort((a, b) => a - b)) {
    const result = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock_shared(${USER_REFERENCE_LOCK_NS}, ${userId}) AS acquired`,
    );
    const rows = (result as unknown as { rows?: { acquired?: boolean }[] }).rows ?? [];
    if (rows[0]?.acquired !== true) throw new UserReferenceBusyError();
  }
  if (ids.length === 0) return null;
  const rows = await tx.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.id, ids));
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.find((id) => !found.has(id));
  return missing == null ? null : `Referenced user ${missing} does not exist`;
}