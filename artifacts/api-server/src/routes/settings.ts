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
    tableStyle: row.tableStyle ?? "plain",
    tableStripeColor: row.tableStripeColor ?? null,
    tableHeaderColor: row.tableHeaderColor ?? null,
    tableBorderColor: row.tableBorderColor ?? null,
    updatedAt: row.updatedAt,
  });
});

/** Validate an optional hex colour; null/empty clears it. Returns the
 * normalised value (null when cleared) or throws on a malformed string so
 * untrusted input can never reach the inline CSS used to render the table. */
function normalizeHexColor(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error("invalid hex colour");
  }
  return value.toLowerCase();
}

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
    if (parsed.data.tableStyle !== undefined) updates.tableStyle = parsed.data.tableStyle;
    try {
      if (parsed.data.tableStripeColor !== undefined)
        updates.tableStripeColor = normalizeHexColor(parsed.data.tableStripeColor);
      if (parsed.data.tableHeaderColor !== undefined)
        updates.tableHeaderColor = normalizeHexColor(parsed.data.tableHeaderColor);
      if (parsed.data.tableBorderColor !== undefined)
        updates.tableBorderColor = normalizeHexColor(parsed.data.tableBorderColor);
    } catch {
      res.status(400).json({ error: "Неверный формат цвета. Используйте hex, например #e0f2fe." });
      return;
    }

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
      tableStyle: row.tableStyle ?? "plain",
      tableStripeColor: row.tableStripeColor ?? null,
      tableHeaderColor: row.tableHeaderColor ?? null,
      tableBorderColor: row.tableBorderColor ?? null,
      updatedAt: row.updatedAt,
    });
  },
);

export default router;
