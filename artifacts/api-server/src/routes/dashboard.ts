import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable, pagesTable, loginHistoryTable } from "@workspace/db";
import { eq, sql, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/stats", requireAuth, async (_req, res): Promise<void> => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    usersResult,
    activeResult,
    blockedResult,
    rolesResult,
    pagesResult,
    recentLoginsResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.isActive, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.isActive, false)),
    db.select({ count: sql<number>`count(*)::int` }).from(rolesTable),
    db.select({ count: sql<number>`count(*)::int` }).from(pagesTable).where(eq(pagesTable.isActive, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(loginHistoryTable).where(gte(loginHistoryTable.createdAt, oneDayAgo)),
  ]);

  res.json({
    totalUsers: usersResult[0]?.count ?? 0,
    activeUsers: activeResult[0]?.count ?? 0,
    blockedUsers: blockedResult[0]?.count ?? 0,
    totalRoles: rolesResult[0]?.count ?? 0,
    totalPages: pagesResult[0]?.count ?? 0,
    recentLogins: recentLoginsResult[0]?.count ?? 0,
  });
});

export default router;
