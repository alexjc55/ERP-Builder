import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { JwtPayload } from "./jwt";

type Account = { id: number; isActive: boolean; sessionVersion: number };

export function matchesSessionAccounts(payload: JwtPayload, accounts: Account[]): boolean {
  const user = accounts.find((row) => row.id === payload.userId);
  if (!user?.isActive || user.sessionVersion !== payload.sessionVersion) return false;
  if (payload.impersonatorId !== undefined) {
    const original = accounts.find((row) => row.id === payload.impersonatorId);
    if (!original?.isActive || original.sessionVersion !== payload.impersonatorSessionVersion) return false;
  }
  return true;
}

/** No allow-cache: a committed revocation must apply across every API process. */
export async function isUserSessionCurrent(payload: JwtPayload): Promise<boolean> {
  const ids = [...new Set([payload.userId, ...(payload.impersonatorId ? [payload.impersonatorId] : [])])];
  const accounts = await db.select({
    id: usersTable.id, isActive: usersTable.isActive, sessionVersion: usersTable.sessionVersion,
  }).from(usersTable).where(inArray(usersTable.id, ids));
  return matchesSessionAccounts(payload, accounts);
}
