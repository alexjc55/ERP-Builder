import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";

const router: IRouter = Router();

const SETTINGS_ID = 1;

/** Read the singleton settings row, creating it on first access. */
async function getOrCreateSettings() {
  const [existing] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, SETTINGS_ID));
  if (existing) return existing;

  const [created] = await db
    .insert(appSettingsTable)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, SETTINGS_ID));
  return row;
}

/**
 * GET /settings — platform branding. Available to any authenticated user so the
 * sidebar header can render (the PUT below is the hard admin boundary).
 */
router.get("/settings", requireAuth, async (_req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  res.json({
    appNameJson: row.appNameJson ?? {},
    subtitleJson: row.subtitleJson ?? {},
    logoObjectPath: row.logoObjectPath ?? null,
    currencySymbol: row.currencySymbol ?? "₽",
    defaultLanguage: row.defaultLanguage ?? "ru",
    updatedAt: row.updatedAt,
  });
});

/**
 * PUT /settings — update platform branding. Gated by the "settings" admin
 * capability (superAdmin bypasses). Singleton upsert on id=1.
 */
router.put(
  "/settings",
  requireAuth,
  requireAdmin("settings"),
  async (req, res): Promise<void> => {
    const parsed = UpdateSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.appNameJson !== undefined) updates.appNameJson = parsed.data.appNameJson;
    if (parsed.data.subtitleJson !== undefined) updates.subtitleJson = parsed.data.subtitleJson;
    if (parsed.data.logoObjectPath !== undefined) updates.logoObjectPath = parsed.data.logoObjectPath;
    if (parsed.data.currencySymbol !== undefined) updates.currencySymbol = parsed.data.currencySymbol;
    if (parsed.data.defaultLanguage !== undefined) updates.defaultLanguage = parsed.data.defaultLanguage;

    // Ensure the row exists, then apply any provided fields.
    await getOrCreateSettings();
    if (Object.keys(updates).length > 0) {
      await db
        .update(appSettingsTable)
        .set(updates)
        .where(eq(appSettingsTable.id, SETTINGS_ID));
    }

    const [row] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, SETTINGS_ID));

    res.json({
      appNameJson: row.appNameJson ?? {},
      subtitleJson: row.subtitleJson ?? {},
      logoObjectPath: row.logoObjectPath ?? null,
      currencySymbol: row.currencySymbol ?? "₽",
      defaultLanguage: row.defaultLanguage ?? "ru",
      updatedAt: row.updatedAt,
    });
  },
);

export default router;
