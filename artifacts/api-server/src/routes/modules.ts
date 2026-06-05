import { Router, type IRouter } from "express";
import { db, modulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  CreateModuleBody,
  UpdateModuleBody,
  GetModuleParams,
  UpdateModuleParams,
  DeleteModuleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const MODULE_KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Unwrap drizzle's query-error wrapper to find the underlying pg error. */
function pgError(err: unknown): { code?: string; constraint?: string } | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    if ("code" in e && typeof (e as { code?: unknown }).code === "string") {
      return e as { code?: string; constraint?: string };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return pgError(err)?.code === "23505";
}

/**
 * Stage 15 — Modules Architecture.
 *
 * CRUD for the module registry: the metadata-driven infrastructure that
 * prepares the platform for future plugins (WhatsApp, Telegram, PDF, etc.).
 * No plugin behaviour is implemented here — this is purely the registry.
 * Every route is gated by the `modules` admin capability (superAdmin bypasses).
 */
router.get("/modules", requireAuth, requireAdmin("modules"), async (_req, res): Promise<void> => {
  const modules = await db.select().from(modulesTable).orderBy(modulesTable.createdAt);
  res.json(modules);
});

router.post("/modules", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const parsed = CreateModuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const moduleKey = parsed.data.moduleKey.trim();
  if (!MODULE_KEY_RE.test(moduleKey)) {
    res.status(400).json({ error: "Invalid moduleKey (use lowercase letters, digits, underscores; must start with a letter)" });
    return;
  }

  const [existing] = await db
    .select({ id: modulesTable.id })
    .from(modulesTable)
    .where(eq(modulesTable.moduleKey, moduleKey));
  if (existing) {
    res.status(409).json({ error: "Module key already exists" });
    return;
  }

  try {
    const [module] = await db
      .insert(modulesTable)
      .values({
        moduleKey,
        nameJson: parsed.data.nameJson,
        ...(parsed.data.version != null ? { version: parsed.data.version } : {}),
        ...(parsed.data.isEnabled != null ? { isEnabled: parsed.data.isEnabled } : {}),
        ...(parsed.data.settingsJson != null ? { settingsJson: parsed.data.settingsJson } : {}),
      })
      .returning();
    res.status(201).json(module);
  } catch (err) {
    // Race: a concurrent insert may slip past the read-before-write check above.
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Module key already exists" });
      return;
    }
    throw err;
  }
});

router.get("/modules/:id", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const params = GetModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [module] = await db
    .select()
    .from(modulesTable)
    .where(eq(modulesTable.id, params.data.id));

  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }

  res.json(module);
});

router.put("/modules/:id", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const params = UpdateModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateModuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // moduleKey is immutable: it is intentionally not accepted on update.
  const updateData: Record<string, unknown> = {};
  if (parsed.data.nameJson != null) updateData.nameJson = parsed.data.nameJson;
  if (parsed.data.version != null) updateData.version = parsed.data.version;
  if (parsed.data.isEnabled != null) updateData.isEnabled = parsed.data.isEnabled;
  if (parsed.data.settingsJson != null) updateData.settingsJson = parsed.data.settingsJson;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [module] = await db
    .update(modulesTable)
    .set(updateData)
    .where(eq(modulesTable.id, params.data.id))
    .returning();

  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }

  res.json(module);
});

router.delete("/modules/:id", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const params = DeleteModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(modulesTable)
    .where(eq(modulesTable.id, params.data.id))
    .returning({ id: modulesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Module not found" });
    return;
  }

  res.json({ success: true, message: "Module deleted" });
});

export default router;
