import { Router, type IRouter } from "express";
import { db, translationsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  CreateTranslationBody,
  UpdateTranslationBody,
  UpdateTranslationParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/translations", requireAuth, async (_req, res): Promise<void> => {
  const translations = await db
    .select()
    .from(translationsTable)
    .orderBy(asc(translationsTable.translationKey));
  res.json(translations);
});

router.post("/translations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateTranslationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [translation] = await db
    .insert(translationsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(translation);
});

router.put("/translations/:key", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTranslationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTranslationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [translation] = await db
    .update(translationsTable)
    .set({ translationsJson: parsed.data.translationsJson })
    .where(eq(translationsTable.translationKey, params.data.key))
    .returning();

  if (!translation) {
    res.status(404).json({ error: "Translation not found" });
    return;
  }

  res.json(translation);
});

export default router;
