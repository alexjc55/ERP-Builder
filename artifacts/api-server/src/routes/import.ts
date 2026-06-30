import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  entityRecordsTable,
  entityStatusesTable,
  entitiesTable,
  usersTable,
  relationsTable,
  recordLinksTable,
} from "@workspace/db";
import type { EntityField, EntityStatus } from "@workspace/db";
import { eq, and, sql, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import { isGoogleDriveModuleEnabled } from "../lib/googleDrive";
import { matchOption, optionLabels } from "../lib/selectOptions";
import {
  validateValues,
  loadActiveFields,
  validateUserRefs,
  checkValidationRules,
  checkDependentValues,
  checkUniqueKeys,
  checkImmutableFields,
  isEmpty,
  UNIQUE_KEY_LOCK_NS,
} from "./records";
import {
  PreviewEntityImportParams,
  PreviewEntityImportBody,
  CommitEntityImportParams,
  CommitEntityImportBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Dynamic file import (XLSX/CSV → entity records).
 *
 * The client (erp-platform) parses the uploaded spreadsheet, maps columns to
 * fields/relations/status, and posts JSON rows here. The server is the hard
 * boundary: every row is coerced per field type and then pushed through the SAME
 * validation the normal records create/update path uses (validateValues →
 * validateUserRefs → checkDependentValues → checkValidationRules → unique-key),
 * so import can never inject data that violates the entity's integrity rules.
 *
 * Import is ADMIN-authoritative (gated by the `dataImport` cap): it writes every
 * mapped field regardless of per-field edit perms — but it cannot bypass the
 * type/required/relation/uniqueness rules above. Entity fields only; page-local
 * fields, file fields, and computed (function/relation/lookup) fields are not
 * importable.
 */

type RelationRow = typeof relationsTable.$inferSelect;

function mlName(j: unknown, fallback: string): string {
  const o = (j ?? {}) as Record<string, unknown>;
  return (
    (typeof o.ru === "string" && o.ru) ||
    (typeof o.en === "string" && o.en) ||
    (typeof o.he === "string" && o.he) ||
    fallback
  );
}

const norm = (s: string) => s.trim().toLowerCase();

const NON_IMPORTABLE = new Set(["file", "function", "relation", "lookup"]);

type Coerced = { value: unknown } | { error: string };

/** Coerce a raw spreadsheet cell into the shape `validateValues` expects. */
async function coerceValue(field: EntityField, raw: unknown): Promise<Coerced> {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { value: undefined };
  }
  const name = mlName(field.nameJson, field.fieldKey);
  switch (field.fieldType) {
    case "text":
    case "textarea":
    case "url":
    case "email":
    case "phone":
      return { value: typeof raw === "string" ? raw.trim() : String(raw).trim() };
    case "number": {
      if (typeof raw === "number") {
        return Number.isFinite(raw) ? { value: raw } : { error: `Поле «${name}»: некорректное число` };
      }
      const cleaned = String(raw).trim().replace(/\s/g, "").replace(",", ".");
      const n = Number(cleaned);
      return Number.isFinite(n) ? { value: n } : { error: `Поле «${name}»: «${String(raw)}» не является числом` };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      const s = norm(String(raw));
      if (["true", "1", "да", "yes", "истина", "y", "+"].includes(s)) return { value: true };
      if (["false", "0", "нет", "no", "ложь", "n", "-"].includes(s)) return { value: false };
      return { error: `Поле «${name}»: «${String(raw)}» не распознано как да/нет` };
    }
    case "date":
    case "datetime": {
      const s = String(raw).trim();
      let ms = Date.parse(s);
      if (Number.isNaN(ms)) {
        const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
        if (m) {
          const d = m[1]!;
          const mo = m[2]!;
          const y = m[3]!;
          const yy = y.length === 2 ? `20${y}` : y;
          ms = Date.parse(`${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
        }
      }
      if (Number.isNaN(ms)) return { error: `Поле «${name}»: «${String(raw)}» не является датой` };
      const iso = new Date(ms).toISOString();
      return { value: field.fieldType === "date" ? iso.slice(0, 10) : iso };
    }
    case "select": {
      const s = String(raw).trim();
      const hit = matchOption(field.optionsJson, s);
      if (!hit)
        return {
          error: `Поле «${name}»: «${String(raw)}» не входит в список допустимых значений (${optionLabels(field.optionsJson).join(", ")})`,
        };
      return { value: hit.value };
    }
    case "user": {
      if (typeof raw === "number" && Number.isInteger(raw)) return { value: raw };
      const s = String(raw).trim();
      if (/^\d+$/.test(s)) return { value: Number(s) };
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(sql`lower(${usersTable.email}) = ${norm(s)}`)
        .limit(1);
      if (!u) return { error: `Поле «${name}»: пользователь «${String(raw)}» не найден (укажите email)` };
      return { value: u.id };
    }
    default:
      return { value: typeof raw === "string" ? raw.trim() : raw };
  }
}

function resolveStatusId(
  statuses: EntityStatus[],
  statusName: string | null | undefined,
): { id: number | null } | { error: string } {
  if (statusName == null || statusName.trim() === "") {
    const def = statuses.find((s) => s.isDefault);
    return { id: def ? def.id : null };
  }
  const s = statusName.trim();
  const hit =
    statuses.find((st) => st.statusKey === s) ??
    statuses.find((st) => norm(st.statusKey) === norm(s) || norm(mlName(st.nameJson, st.statusKey)) === norm(s));
  if (!hit) return { error: `Статус «${statusName}» не найден` };
  return { id: hit.id };
}

/** Resolve a relation target record id by matching a key field value. */
async function resolveTarget(
  targetEntityId: number,
  targetKeyFieldKey: string,
  value: string,
): Promise<{ id: number } | { error: string }> {
  const matches = await db
    .select({ id: entityRecordsTable.id })
    .from(entityRecordsTable)
    .where(
      and(
        eq(entityRecordsTable.entityId, targetEntityId),
        sql`lower(trim(${entityRecordsTable.valuesJson} ->> ${targetKeyFieldKey})) = ${norm(value)}`,
        sql`${entityRecordsTable.archivedAt} is null`,
      ),
    )
    .limit(2);
  if (matches.length === 0) return { error: `«${value}» не найдено` };
  if (matches.length > 1) return { error: `«${value}» соответствует нескольким записям` };
  return { id: matches[0]!.id };
}

type RelAssignment = { relationId: number; relationType: string; targetIds: number[] };

interface RowContext {
  entityId: number;
  fields: EntityField[];
  fieldByKey: Map<string, EntityField>;
  statuses: EntityStatus[];
  gdrive: boolean;
  keyField: EntityField | undefined;
  keyFields: EntityField[];
  relCols: { relationId: number; targetKeyFieldKey: string }[];
  relById: Map<number, RelationRow>;
  dryRun: boolean;
}

type RowOutcome = { status: "created" | "updated" | "skipped" | "error"; message?: string };

async function applyRelations(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sourceRecordId: number,
  assignments: RelAssignment[],
): Promise<void> {
  for (const a of assignments) {
    // Replace semantics: a re-import of the same source row resets its links for
    // this relation, then re-creates them — keeping re-runs idempotent. A cross-
    // source target-unique conflict (one_to_one / one_to_many) throws and surfaces
    // as a row error (the whole row rolls back).
    await tx
      .delete(recordLinksTable)
      .where(and(eq(recordLinksTable.relationId, a.relationId), eq(recordLinksTable.sourceRecordId, sourceRecordId)));
    for (const tid of a.targetIds) {
      await tx.insert(recordLinksTable).values({
        relationId: a.relationId,
        relationType: a.relationType,
        sourceRecordId,
        targetRecordId: tid,
      });
    }
  }
}

async function processRow(
  row: { index: number; values: Record<string, unknown>; relations?: Record<string, string[]>; statusName?: string | null },
  ctx: RowContext,
): Promise<RowOutcome> {
  // 1. Coerce mapped cells into the per-type shape validateValues expects.
  const incoming: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(row.values)) {
    const field = ctx.fieldByKey.get(k);
    if (!field || NON_IMPORTABLE.has(field.fieldType)) continue;
    const c = await coerceValue(field, raw);
    if ("error" in c) return { status: "error", message: c.error };
    if (c.value !== undefined) incoming[k] = c.value;
  }

  // 2. Upsert match — locate an existing record by the chosen key BEFORE validation,
  // so the integrity boundary below runs on the FINAL (merged) state, exactly like
  // PUT /records/:id does. Matching on the coerced incoming value mirrors how the
  // value is stored/compared.
  let existingId: number | null = null;
  let existingValues: Record<string, unknown> = {};
  if (ctx.keyField) {
    const kv = incoming[ctx.keyField.fieldKey];
    if (!isEmpty(kv)) {
      const kvStr = typeof kv === "string" ? kv : String(kv);
      const [hit] = await db
        .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(
          and(
            eq(entityRecordsTable.entityId, ctx.entityId),
            sql`lower(trim(${entityRecordsTable.valuesJson} ->> ${ctx.keyField.fieldKey})) = ${norm(kvStr)}`,
            sql`${entityRecordsTable.archivedAt} is null`,
          ),
        )
        .limit(1);
      if (hit) {
        existingId = hit.id;
        existingValues = (hit.valuesJson as Record<string, unknown>) ?? {};
      }
    }
  }

  // 3. The exact integrity boundary the normal record-write path enforces, run on
  // the FINAL state: for an update that is existing ⊕ incoming (merge-on-write,
  // like PUT's candidate), for an insert just the incoming values. prevValues lets
  // validateValues apply the same change-aware rules, and immutability/cross-field
  // rules run on the merged result so import can never bypass what a direct edit
  // would reject.
  // Build the validation target exactly like the matching record-write path:
  //  - UPDATE: compose from ACTIVE fields only (incoming override, else the stored
  //    value), mirroring PUT's candidate so legacy/stale keys lingering in a
  //    record's valuesJson never reach validateValues and trip "Unknown field".
  //  - INSERT: validate the incoming values directly, mirroring POST create.
  let candidate: Record<string, unknown>;
  if (existingId != null) {
    candidate = {};
    for (const f of ctx.fields) {
      const key = f.fieldKey;
      candidate[key] = key in incoming ? incoming[key] : existingValues[key];
    }
  } else {
    candidate = incoming;
  }
  const result = validateValues(ctx.fields, candidate, ctx.gdrive, existingValues);
  if ("error" in result) return { status: "error", message: result.error };
  const values = result.values;
  const userErr = await validateUserRefs(ctx.fields, values);
  if (userErr) return { status: "error", message: userErr };
  const depErr = await checkDependentValues(ctx.entityId, ctx.fields, values, existingId ?? undefined);
  if (depErr) return { status: "error", message: depErr };
  const ruleErr = checkValidationRules(ctx.fields, values);
  if (ruleErr) return { status: "error", message: ruleErr };
  if (existingId != null) {
    const immErr = checkImmutableFields(ctx.fields, values, existingValues);
    if (immErr) return { status: "error", message: immErr };
  }

  // 4. Status: explicit column value or the entity default.
  const st = resolveStatusId(ctx.statuses, row.statusName);
  if ("error" in st) return { status: "error", message: st.error };
  const statusId = st.id;

  // 5. Resolve relation targets by their lookup key (cardinality-aware).
  const relAssignments: RelAssignment[] = [];
  for (const rc of ctx.relCols) {
    const rel = ctx.relById.get(rc.relationId)!;
    const relName = mlName(rel.nameJson, rel.relationKey);
    const vals = (row.relations?.[String(rc.relationId)] ?? []).map((v) => v.trim()).filter((v) => v !== "");
    if (vals.length === 0) continue;
    const single = rel.relationType === "one_to_one" || rel.relationType === "many_to_one";
    if (single && vals.length > 1) {
      return { status: "error", message: `Связь «${relName}»: допускается только одно значение` };
    }
    const targetIds: number[] = [];
    for (const v of vals) {
      const t = await resolveTarget(rel.targetEntityId, rc.targetKeyFieldKey, v);
      if ("error" in t) return { status: "error", message: `Связь «${relName}»: ${t.error}` };
      targetIds.push(t.id);
    }
    relAssignments.push({ relationId: rel.id, relationType: rel.relationType, targetIds });
  }

  // 6. Dry-run: verify isKey uniqueness without persisting (the helper needs a
  // transaction-typed executor; a short read-only tx satisfies that). The commit
  // paths below re-check the SAME way the normal write path does — inside the write
  // transaction under a per-entity advisory lock — so concurrent writes can't race.
  if (ctx.dryRun) {
    if (ctx.keyFields.length > 0) {
      const dup = await db.transaction((tx) =>
        checkUniqueKeys(tx, ctx.entityId, ctx.keyFields, values, existingId ?? undefined),
      );
      if (dup) return { status: "error", message: dup };
    }
    return { status: existingId != null ? "updated" : "created" };
  }

  // 7. Commit one row in its own transaction (partial success across the batch).
  // `values` is the full merged+validated map, so it replaces valuesJson wholesale
  // (matching PUT, which sets update.valuesJson = result.values).
  if (existingId != null) {
    await db.transaction(async (tx) => {
      if (ctx.keyFields.length > 0) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${ctx.entityId})`);
        const dup = await checkUniqueKeys(tx, ctx.entityId, ctx.keyFields, values, existingId!);
        if (dup) throw new Error(dup);
      }
      const setData: { valuesJson: Record<string, unknown>; statusId?: number | null; statusChangedAt?: Date } = {
        valuesJson: values,
      };
      if (row.statusName != null && row.statusName.trim() !== "") {
        setData.statusId = statusId;
        setData.statusChangedAt = new Date();
      }
      await tx.update(entityRecordsTable).set(setData).where(eq(entityRecordsTable.id, existingId!));
      await applyRelations(tx, existingId!, relAssignments);
    });
    return { status: "updated" };
  }

  await db.transaction(async (tx) => {
    if (ctx.keyFields.length > 0) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${ctx.entityId})`);
      const dup = await checkUniqueKeys(tx, ctx.entityId, ctx.keyFields, values);
      if (dup) throw new Error(dup);
    }
    const [rec] = await tx
      .insert(entityRecordsTable)
      .values({ entityId: ctx.entityId, valuesJson: values, statusId, statusChangedAt: new Date() })
      .returning({ id: entityRecordsTable.id });
    if (!rec) throw new Error("Не удалось создать запись");
    await applyRelations(tx, rec.id, relAssignments);
  });
  return { status: "created" };
}

async function runImport(req: Request, res: Response, dryRun: boolean): Promise<void> {
  const ParamsSchema = dryRun ? PreviewEntityImportParams : CommitEntityImportParams;
  const BodySchema = dryRun ? PreviewEntityImportBody : CommitEntityImportBody;

  const params = ParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = BodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const entityId = params.data.entityId;

  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const fields = await loadActiveFields(entityId);
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));
  const statuses = await db
    .select()
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.isActive, true)))
    .orderBy(asc(entityStatusesTable.sortOrder));
  const gdrive = await isGoogleDriveModuleEnabled();

  const keyFieldKey = body.data.keyFieldKey ?? null;
  const keyField = keyFieldKey ? fieldByKey.get(keyFieldKey) : undefined;
  if (keyFieldKey && !keyField) {
    res.status(400).json({ error: `Unknown key field: ${keyFieldKey}` });
    return;
  }
  const keyFields = fields.filter((f) => f.isKey);

  const relations = await db.select().from(relationsTable).where(eq(relationsTable.sourceEntityId, entityId));
  const relById = new Map(relations.map((r) => [r.id, r]));
  const relCols = body.data.relationColumns ?? [];
  for (const rc of relCols) {
    if (!relById.has(rc.relationId)) {
      res.status(400).json({ error: `Unknown relation: ${rc.relationId}` });
      return;
    }
  }

  const ctx: RowContext = { entityId, fields, fieldByKey, statuses, gdrive, keyField, keyFields, relCols, relById, dryRun };

  const results: { index: number; status: RowOutcome["status"]; message: string | null }[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of body.data.rows) {
    try {
      const outcome = await processRow(row, ctx);
      results.push({ index: row.index, status: outcome.status, message: outcome.message ?? null });
      if (outcome.status === "created") created++;
      else if (outcome.status === "updated") updated++;
      else if (outcome.status === "skipped") skipped++;
      else errors++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка импорта строки";
      req.log?.error({ err }, "import row failed");
      results.push({ index: row.index, status: "error", message });
      errors++;
    }
  }

  res.json({ total: body.data.rows.length, created, updated, skipped, errors, rows: results });
}

router.post("/entities/:entityId/import/preview", requireAuth, requireAdmin("dataImport"), async (req, res): Promise<void> => {
  await runImport(req, res, true);
});

router.post("/entities/:entityId/import/commit", requireAuth, requireAdmin("dataImport"), async (req, res): Promise<void> => {
  await runImport(req, res, false);
});

export default router;
