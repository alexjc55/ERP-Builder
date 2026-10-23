import { Router } from "express";
import { z } from "zod/v4";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, cardStylePresetsTable as presets, cardStylePresetInputSchema } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";

const router = Router();
const guard = [requireAuth, requireAdmin("cardTemplates")];
const idSchema = z.coerce.number().int().positive();
router.get("/card-style-presets", ...guard, async (_req, res) => {
  res.json(await db.select().from(presets).orderBy(asc(presets.name), asc(presets.id)));
});
router.post("/card-style-presets", ...guard, async (req, res) => {
  const parsed = cardStylePresetInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, appearance } = parsed.data;
  const [created] = await db.insert(presets).values({ name, appearance }).returning();
  res.status(201).json(created);
});
router.put("/card-style-presets/:id", ...guard, async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = cardStylePresetInputSchema.required({ expectedRevision: true }).safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: "Invalid style preset" }); return; }
  const { name, appearance, expectedRevision } = parsed.data;
  const [updated] = await db.update(presets).set({ name, appearance, revision: sql`${presets.revision} + 1` })
    .where(and(eq(presets.id, id.data), eq(presets.revision, expectedRevision))).returning();
  if (!updated) { res.status(409).json({ error: "Шаблон изменён или удалён. Обновите список." }); return; }
  res.json(updated);
});
router.delete("/card-style-presets/:id", ...guard, async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const revision = idSchema.safeParse(req.query.expectedRevision);
  if (!id.success || !revision.success) { res.status(400).json({ error: "Invalid style preset revision" }); return; }
  const removed = await db.delete(presets).where(and(eq(presets.id, id.data), eq(presets.revision, revision.data))).returning();
  if (!removed.length) { res.status(409).json({ error: "Шаблон изменён или удалён. Обновите список." }); return; }
  res.status(204).end();
});
export default router;
