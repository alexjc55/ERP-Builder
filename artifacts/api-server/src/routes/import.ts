import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  entityRecordsTable,
  entityStatusesTable,
  entitiesTable,
  usersTable,
  relationsTable,
  recordLinksTable,
  pagesTable,
  pageFieldsTable,
  pageRecordValuesTable,
} from "@workspace/db";
import type { EntityField, EntityStatus, PageField } from "@workspace/db";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { lockRecordsStable, touchLockedRecords } from "../lib/record-links";
import {
  emitEvent,
  EVENT_PAGE_FIELD_SAVED,
  EVENT_RECORD_CREATED,
  EVENT_RECORD_UPDATED,
} from "../lib/events";
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
  type DbExecutor,
} from "./records";
import { validatePageValues, effectiveEntityForPage } from "./page-fields";
import {
  lockAndValidateUserReferences,
  referencedUserIds,
  UserReferenceBusyError,
} from "../lib/user-reference-barrier";
import { PreviewImportBody } from "@workspace/api-zod";
import { isManualStatusEditDisabled } from "../lib/status-manual-edit";

const router: IRouter = Router();

/**
 * Multi-file batch import (XLSX/CSV → entity records + page-local values).
 *
 * The client (erp-platform) parses one or more uploaded spreadsheets, maps each
 * file's columns to fields/relations/status (entity file) or to page-local
 * fields plus a host-record lookup key (page file), and posts the whole batch
 * here. The server is the hard boundary: every entity row is coerced per field
 * type and pushed through the SAME validation the normal records create/update
 * path uses (validateValues → validateUserRefs → checkDependentValues →
 * checkValidationRules → unique-key); every page row is type-validated the same
 * way the inline page-value write is.
 *
 * The whole batch runs in ONE transaction so cross-file relations resolve
 * against same-batch inserts (entity files are ordered so relation targets are
 * written before their sources; page files run after all entity files so their
 * host records exist). Preview and commit take the IDENTICAL write path — the
 * only difference is preview ALWAYS rolls back (a true rehearsal) and commit
 * rolls back only if any row/file failed (all-or-nothing: nothing is written
 * unless the entire batch is clean).
 *
 * Import is ADMIN-authoritative (gated by the `dataImport` cap): it writes every
 * mapped field regardless of per-field edit perms — but it cannot bypass the
 * type/required/relation/uniqueness rules above. Entity fields only; file fields
 * and computed (function/relation/lookup) fields are not importable.
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

const NON_IMPORTABLE = new Set(["file", "function", "relation", "lookup", "created_at"]);

/** Minimal field shape coerceValue needs — satisfied by both entity and page fields. */
type CoercibleField = { fieldKey: string; fieldType: string; nameJson: unknown; optionsJson: unknown };

type Coerced = { value: unknown } | { error: string };

/** Coerce a raw spreadsheet cell into the shape validateValues/validatePageValues expects. */
async function coerceValue(field: CoercibleField, raw: unknown): Promise<Coerced> {
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
    case "percent": {
      if (typeof raw === "number") {
        return Number.isFinite(raw) ? { value: raw } : { error: `Поле «${name}»: некорректное число` };
      }
      const cleaned = String(raw).trim().replace(/\s/g, "").replace("%", "").replace(",", ".");
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

/** All non-empty localized labels (ru/en/he) of a status name. */
function statusLabels(j: unknown): string[] {
  const o = (j ?? {}) as Record<string, unknown>;
  return [o.ru, o.en, o.he].filter((x): x is string => typeof x === "string" && x.trim() !== "");
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
  const ns = norm(s);
  const hit =
    statuses.find((st) => st.statusKey === s) ??
    statuses.find((st) => statusLabels(st.nameJson).some((l) => l === s)) ??
    statuses.find(
      (st) => norm(st.statusKey) === ns || statusLabels(st.nameJson).some((l) => norm(l) === ns),
    );
  if (!hit) return { error: `Статус «${statusName}» не найден` };
  return { id: hit.id };
}

/** Empty/null status cells intentionally use the entity default, not a manual assignment. */
function hasExplicitStatusName(statusName: string | null | undefined): boolean {
  return statusName != null && statusName.trim() !== "";
}

/** Resolve a relation target record id by matching a key field value (batch-visible via tx). */
async function resolveTarget(
  exec: DbExecutor,
  targetEntityId: number,
  targetKeyFieldKey: string,
  value: string,
): Promise<{ id: number } | { error: string }> {
  const matches = await exec
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

type RowInput = {
  index: number;
  values: Record<string, unknown>;
  relations?: Record<string, string[]>;
  statusName?: string | null;
  hostKeyValue?: string | null;
};

type RowStatus = "created" | "updated" | "skipped" | "error";
type ImportRecordUpdate = {
  recordId: number;
  entityId: number;
  version: number;
  changedFields: string[];
  statusId?: number | null;
};
type ImportRecordCreate = {
  recordId: number;
  entityId: number;
  version: number;
  statusId: number | null;
  changedFields: string[];
};
type ImportPageUpdate = {
  entityId: number;
  pageId: number;
  recordId: number;
  version: number;
  changedPageFieldKeys: string[];
};
type RowOutcome = {
  status: RowStatus;
  message?: string;
  updates?: ImportRecordUpdate[];
  creates?: ImportRecordCreate[];
  pageUpdates?: ImportPageUpdate[];
};
type LockedImportRelations = {
  oldLinks: (typeof recordLinksTable.$inferSelect)[];
  lockedRecords: (typeof entityRecordsTable.$inferSelect)[];
};

interface EntityCtx {
  kind: "entity";
  entityId: number;
  entityName: string;
  fields: EntityField[];
  fieldByKey: Map<string, EntityField>;
  statuses: EntityStatus[];
  gdrive: boolean;
  keyField: EntityField | undefined;
  keyFields: EntityField[];
  relCols: { relationId: number; targetKeyFieldKey: string }[];
  relById: Map<number, RelationRow>;
}

interface PageCtx {
  kind: "page";
  pageId: number;
  pageName: string;
  mirrorEntityId: number;
  hostKeyField: EntityField;
  pageFields: PageField[];
}

type Prepared =
  | { kind: "entity"; originalIndex: number; label: string | null; ctx: EntityCtx; rows: RowInput[] }
  | { kind: "page"; originalIndex: number; label: string | null; ctx: PageCtx; rows: RowInput[] }
  | {
      kind: "error";
      originalIndex: number;
      label: string | null;
      fileKind: "entity" | "page";
      targetName: string | null;
      error: string;
      total: number;
    };

interface FileResult {
  index: number;
  kind: "entity" | "page";
  label: string | null;
  targetName: string | null;
  error: string | null;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: { index: number; status: RowStatus; message: string | null }[];
}

async function applyRelations(
  tx: DbExecutor,
  sourceRecordId: number,
  assignments: RelAssignment[],
  touchSource: boolean,
  prepared?: LockedImportRelations,
): Promise<ImportRecordUpdate[]> {
  const ordered = [...assignments].sort((a, b) => a.relationId - b.relationId);
  if (ordered.length === 0) return [];
  const relationIds = [...new Set(ordered.map((assignment) => assignment.relationId))];
  let oldLinks: (typeof recordLinksTable.$inferSelect)[];
  let lockedRecords: (typeof entityRecordsTable.$inferSelect)[];
  if (prepared) {
    ({ oldLinks, lockedRecords } = prepared);
  } else {
    await tx.select({ id: relationsTable.id }).from(relationsTable)
      .where(inArray(relationsTable.id, relationIds)).orderBy(asc(relationsTable.id)).for("update");
    const observedOldLinks = await tx.select().from(recordLinksTable)
      .where(and(inArray(recordLinksTable.relationId, relationIds), eq(recordLinksTable.sourceRecordId, sourceRecordId)))
      .orderBy(asc(recordLinksTable.id));
    const oldTargets = observedOldLinks.map((link) => link.targetRecordId);
    const newTargets = ordered.flatMap((assignment) => assignment.targetIds);
    lockedRecords = await lockRecordsStable(tx, [sourceRecordId, ...oldTargets, ...newTargets]);
    oldLinks = await tx.select().from(recordLinksTable)
      .where(and(inArray(recordLinksTable.relationId, relationIds), eq(recordLinksTable.sourceRecordId, sourceRecordId)))
      .orderBy(asc(recordLinksTable.id)).for("update");
  }
  const changedEndpoints = new Set<number>();
  for (const a of ordered) {
    const before = oldLinks.filter((link) => link.relationId === a.relationId).map((link) => link.targetRecordId).sort((x, y) => x - y);
    const after = [...new Set(a.targetIds)].sort((x, y) => x - y);
    if (before.length === after.length && before.every((id, index) => id === after[index])) continue;
    before.forEach((id) => changedEndpoints.add(id));
    after.forEach((id) => changedEndpoints.add(id));
    // Replace semantics: a re-import of the same source row resets its links for
    // this relation, then re-creates them — keeping re-runs idempotent.
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
  const affected = [...changedEndpoints].filter((recordId) => recordId !== sourceRecordId);
  if (changedEndpoints.size > 0 && touchSource) affected.push(sourceRecordId);
  const versions = await touchLockedRecords(tx, affected);
  const entityById = new Map(lockedRecords.map((record) => [record.id, record.entityId]));
  return affected.flatMap((recordId) => {
    const entityId = entityById.get(recordId);
    const version = versions[String(recordId)];
    return entityId == null || version == null ? [] : [{ recordId, entityId, version, changedFields: [] }];
  });
}

async function lockImportRelationEndpoints(
  tx: DbExecutor,
  sourceRecordId: number,
  assignments: RelAssignment[],
): Promise<LockedImportRelations> {
  const relationIds = [...new Set(assignments.map((assignment) => assignment.relationId))].sort((a, b) => a - b);
  if (relationIds.length === 0) {
    return { oldLinks: [], lockedRecords: await lockRecordsStable(tx, [sourceRecordId]) };
  }
  await tx.select({ id: relationsTable.id }).from(relationsTable)
    .where(inArray(relationsTable.id, relationIds)).orderBy(asc(relationsTable.id)).for("update");
  const observedOldLinks = await tx.select().from(recordLinksTable)
    .where(and(inArray(recordLinksTable.relationId, relationIds), eq(recordLinksTable.sourceRecordId, sourceRecordId)))
    .orderBy(asc(recordLinksTable.id));
  const lockedRecords = await lockRecordsStable(tx, [
    sourceRecordId,
    ...observedOldLinks.map((link) => link.targetRecordId),
    ...assignments.flatMap((assignment) => assignment.targetIds),
  ]);
  const oldLinks = await tx.select().from(recordLinksTable)
    .where(and(inArray(recordLinksTable.relationId, relationIds), eq(recordLinksTable.sourceRecordId, sourceRecordId)))
    .orderBy(asc(recordLinksTable.id)).for("update");
  return { oldLinks, lockedRecords };
}

async function processEntityRow(
  tx: DbExecutor,
  row: RowInput,
  ctx: EntityCtx,
  actorUserId: number,
): Promise<RowOutcome> {
  // 1. Coerce mapped cells into the per-type shape validateValues expects.
  const incoming: Record<string, unknown> = {};
  // File fields are NON_IMPORTABLE: this path merges only non-file spreadsheet
  // cells (plus status) and has no workflow set_field actions. An update can
  // preserve an existing Drive object, while a create can never contain one.
  for (const [k, raw] of Object.entries(row.values)) {
    const field = ctx.fieldByKey.get(k);
    if (!field || NON_IMPORTABLE.has(field.fieldType)) continue;
    const c = await coerceValue(field, raw);
    if ("error" in c) return { status: "error", message: c.error };
    if (c.value !== undefined) incoming[k] = c.value;
  }

  // Import is an admin-authoritative field writer, but a supplied statusName is
  // still a human's explicit status choice. Defaults (omitted/empty cells) and
  // all non-import system writers remain outside this boundary.
  if (hasExplicitStatusName(row.statusName)) {
    const [entity] = await tx
      .select({
        policy: entitiesTable.statusManualEditPolicy,
        userIds: entitiesTable.statusManualEditUserIds,
      })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, ctx.entityId))
      .limit(1);
    if (entity && isManualStatusEditDisabled(entity.policy, entity.userIds, actorUserId)) {
      return { status: "error", message: "Manual status editing is disabled for this user" };
    }
  }

  // 2. Upsert match (via tx so same-batch inserts are visible) — locate an
  // existing record by the chosen key BEFORE validation so the boundary runs on
  // the FINAL merged state, exactly like PUT /records/:id.
  let existingId: number | null = null;
  if (ctx.keyField) {
    const kv = incoming[ctx.keyField.fieldKey];
    if (!isEmpty(kv)) {
      const kvStr = typeof kv === "string" ? kv : String(kv);
      const [hit] = await tx
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
      }
    }
  }

  const validateFinalValues = async (
    executor: DbExecutor,
    currentValues: Record<string, unknown>,
    currentId?: number,
  ): Promise<Record<string, unknown>> => {
    const candidate: Record<string, unknown> = {};
    for (const f of ctx.fields) {
      const key = f.fieldKey;
      candidate[key] = key in incoming ? incoming[key] : currentValues[key];
    }
    const result = validateValues(ctx.fields, candidate, ctx.gdrive, currentValues);
    if ("error" in result) throw new Error(result.error);
    const finalValues = { ...currentValues };
    for (const field of ctx.fields) {
      if (Object.prototype.hasOwnProperty.call(result.values, field.fieldKey)) {
        finalValues[field.fieldKey] = result.values[field.fieldKey];
      } else {
        delete finalValues[field.fieldKey];
      }
    }
    const userErr = await validateUserRefs(ctx.fields, finalValues, executor);
    if (userErr) throw new Error(userErr);
    const depErr = await checkDependentValues(ctx.entityId, ctx.fields, finalValues, currentId, executor);
    if (depErr) throw new Error(depErr);
    const ruleErr = checkValidationRules(ctx.fields, finalValues);
    if (ruleErr) throw new Error(ruleErr);
    if (currentId != null) {
      const immErr = checkImmutableFields(ctx.fields, finalValues, currentValues);
      if (immErr) throw new Error(immErr);
    }
    return finalValues;
  };

  // 4. Status: explicit column value or the entity default.
  const st = resolveStatusId(ctx.statuses, row.statusName);
  if ("error" in st) return { status: "error", message: st.error };
  const statusId = st.id;

  // 5. Resolve relation targets by their lookup key (cardinality-aware, tx-visible).
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
      const t = await resolveTarget(tx, rel.targetEntityId, rc.targetKeyFieldKey, v);
      if ("error" in t) return { status: "error", message: `Связь «${relName}»: ${t.error}` };
      targetIds.push(t.id);
    }
    relAssignments.push({ relationId: rel.id, relationType: rel.relationType, targetIds });
  }

  // 6. Write the row inside a SAVEPOINT so a row-level DB error rolls back only
  // this row (letting the batch collect every error) while the advisory lock held
  // on the outer transaction still serializes unique-key checks. `values` is the
  // full merged+validated map, so it replaces valuesJson wholesale (matching PUT).
  let updates: ImportRecordUpdate[] = [];
  let creates: ImportRecordCreate[] = [];
  try {
    await tx.transaction(async (sp) => {
      if (ctx.keyFields.length > 0) {
        // Checked again below from the locked/rebased final value map.
      }
      if (existingId != null) {
        const preparedRelations = await lockImportRelationEndpoints(sp, existingId, relAssignments);
        const lockedSource = preparedRelations.lockedRecords.find((record) => record.id === existingId);
        if (!lockedSource || lockedSource.entityId !== ctx.entityId || lockedSource.archivedAt != null) {
          throw new Error("Сопоставленная запись больше недоступна");
        }
        if (ctx.keyField) {
          const requestedKey = incoming[ctx.keyField.fieldKey];
          const lockedKey = (lockedSource.valuesJson as Record<string, unknown>)[ctx.keyField.fieldKey];
          if (!isEmpty(requestedKey) && norm(String(requestedKey)) !== norm(String(lockedKey ?? ""))) {
            throw new Error("Ключ сопоставленной записи изменился; повторите импорт");
          }
        }
        const lockedValues = (lockedSource.valuesJson as Record<string, unknown>) ?? {};
        const values = await validateFinalValues(sp, lockedValues, existingId);
        if (ctx.keyFields.length > 0) {
          const dup = await checkUniqueKeys(sp, ctx.entityId, ctx.keyFields, values, existingId);
          if (dup) throw new Error(dup);
        }
        const setData: { valuesJson: Record<string, unknown>; statusId?: number | null; statusChangedAt?: Date } = {
          valuesJson: values,
        };
        const scalarChangedFields = Object.keys(incoming).filter((key) =>
          JSON.stringify(lockedValues[key]) !== JSON.stringify(values[key]));
        const explicitStatus = hasExplicitStatusName(row.statusName);
        const statusChanged = explicitStatus && lockedSource.statusId !== statusId;
        if (statusChanged) {
          setData.statusId = statusId;
          setData.statusChangedAt = new Date();
        }
        const relationUpdates = await applyRelations(sp, existingId, relAssignments, false, preparedRelations);
        const relationChanged = relationUpdates.length > 0;
        const changedFields = [...scalarChangedFields];
        if (statusChanged) changedFields.push("__status__");
        const shouldUpdateSource = scalarChangedFields.length > 0 || statusChanged || relationChanged;
        const [updatedSource] = shouldUpdateSource
          ? await sp.update(entityRecordsTable).set({
              ...setData,
              ...(relationChanged && scalarChangedFields.length === 0 && !statusChanged ? { updatedAt: new Date() } : {}),
            })
            .where(eq(entityRecordsTable.id, existingId))
            .returning({
              id: entityRecordsTable.id,
              entityId: entityRecordsTable.entityId,
              statusId: entityRecordsTable.statusId,
              version: entityRecordsTable.version,
            })
          : [];
        updates = [
          ...relationUpdates,
          ...(updatedSource ? [{
            recordId: updatedSource.id,
            entityId: updatedSource.entityId,
            version: updatedSource.version,
            changedFields,
              statusId: updatedSource.statusId,
          }] : []),
        ];
      } else {
        const values = await validateFinalValues(sp, {}, undefined);
        if (ctx.keyFields.length > 0) {
          const dup = await checkUniqueKeys(sp, ctx.entityId, ctx.keyFields, values, undefined);
          if (dup) throw new Error(dup);
        }
        const [rec] = await sp
          .insert(entityRecordsTable)
          .values({ entityId: ctx.entityId, valuesJson: values, statusId, statusChangedAt: new Date() })
          .returning({
            id: entityRecordsTable.id,
            entityId: entityRecordsTable.entityId,
            statusId: entityRecordsTable.statusId,
            version: entityRecordsTable.version,
          });
        if (!rec) throw new Error("Не удалось создать запись");
        const relationUpdates = await applyRelations(sp, rec.id, relAssignments, true);
        const sourceTouch = relationUpdates.find((update) => update.recordId === rec.id);
        updates = relationUpdates.filter((update) => update.recordId !== rec.id);
        creates = [{
          recordId: rec.id,
          entityId: rec.entityId,
          statusId: rec.statusId,
          version: sourceTouch?.version ?? rec.version,
          changedFields: Object.keys(values),
        }];
      }
    });
  } catch (err) {
    if (err instanceof UserReferenceBusyError) throw err;
    return { status: "error", message: err instanceof Error ? err.message : "Ошибка импорта строки" };
  }
  return { status: existingId != null ? "updated" : "created", updates, creates };
}

async function processPageRow(tx: DbExecutor, row: RowInput, ctx: PageCtx): Promise<RowOutcome> {
  // Locate the host record on the mirrored entity by the file's host key field.
  const hkv = row.hostKeyValue;
  const hkName = mlName(ctx.hostKeyField.nameJson, ctx.hostKeyField.fieldKey);
  if (isEmpty(hkv)) return { status: "error", message: `Не указано значение поля «${hkName}» для поиска записи` };
  const hkStr = typeof hkv === "string" ? hkv.trim() : String(hkv);
  const hosts = await tx
    .select({ id: entityRecordsTable.id })
    .from(entityRecordsTable)
    .where(
      and(
        eq(entityRecordsTable.entityId, ctx.mirrorEntityId),
        sql`lower(trim(${entityRecordsTable.valuesJson} ->> ${ctx.hostKeyField.fieldKey})) = ${norm(hkStr)}`,
        sql`${entityRecordsTable.archivedAt} is null`,
      ),
    )
    .limit(2);
  if (hosts.length === 0) return { status: "error", message: `Запись «${hkStr}» не найдена` };
  if (hosts.length > 1) return { status: "error", message: `«${hkStr}» соответствует нескольким записям` };
  const recordId = hosts[0]!.id;

  // Coerce + type-validate the page-local values exactly like the inline write.
  const pfByKey = new Map(ctx.pageFields.map((pf) => [pf.fieldKey, pf]));
  const incoming: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(row.values)) {
    const pf = pfByKey.get(k);
    if (!pf || NON_IMPORTABLE.has(pf.fieldType)) continue;
    const c = await coerceValue(pf, raw);
    if ("error" in c) return { status: "error", message: c.error };
    if (c.value !== undefined) incoming[k] = c.value;
  }
  if (Object.keys(incoming).length === 0) return { status: "skipped" };

  // MERGE existing ⊕ cleaned into page_record_values (unique pageId,recordId),
  // inside a savepoint for per-row error isolation.
  try {
    let created = false;
    let changedPageFieldKeys: string[] = [];
    let version: number | undefined;
    await tx.transaction(async (sp) => {
      await sp.execute(
        sql`SELECT pg_advisory_xact_lock((${ctx.pageId}::bigint << 32) | ${recordId}::bigint)`,
      );
      const [existing] = await sp
        .select({ id: pageRecordValuesTable.id, valuesJson: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(and(eq(pageRecordValuesTable.pageId, ctx.pageId), eq(pageRecordValuesTable.recordId, recordId)))
        .limit(1)
        .for("update");
      const previous = (existing?.valuesJson as Record<string, unknown> | undefined) ?? {};
      const mergedInput = { ...previous, ...incoming };
      // File fields are NON_IMPORTABLE above and Drive is deliberately disabled;
      // this path can only preserve an existing ID, never introduce one.
      const validated = validatePageValues(ctx.pageFields, mergedInput, false, previous);
      if ("error" in validated) throw new Error(validated.error);
      // Keep unrelated/inactive stored keys while applying the normalized
      // imported keys from the locked current row.
      const cleaned = { ...previous };
      for (const key of Object.keys(incoming)) {
        if (Object.prototype.hasOwnProperty.call(validated.values, key)) cleaned[key] = validated.values[key];
        else delete cleaned[key];
      }
      changedPageFieldKeys = Object.keys(incoming).filter((key) =>
        JSON.stringify(previous[key] ?? null) !== JSON.stringify(cleaned[key] ?? null));
      if (changedPageFieldKeys.length === 0) return;
      const userRefError = await lockAndValidateUserReferences(
        sp,
        referencedUserIds(ctx.pageFields, cleaned),
      );
      if (userRefError) throw new Error(userRefError);
      if (existing) {
        const [written] = await sp.update(pageRecordValuesTable)
          .set({ valuesJson: cleaned })
          .where(eq(pageRecordValuesTable.id, existing.id))
          .returning({ version: pageRecordValuesTable.version });
        version = written?.version;
      } else {
        const [written] = await sp.insert(pageRecordValuesTable)
          .values({ pageId: ctx.pageId, recordId, valuesJson: cleaned })
          .returning({ version: pageRecordValuesTable.version });
        version = written?.version;
        created = true;
      }
    });
    if (version == null || changedPageFieldKeys.length === 0) return { status: "skipped" };
    return {
      status: created ? "created" : "updated",
      pageUpdates: [{
        entityId: ctx.mirrorEntityId,
        pageId: ctx.pageId,
        recordId,
        version,
        changedPageFieldKeys,
      }],
    };
  } catch (err) {
    if (err instanceof UserReferenceBusyError) throw err;
    return { status: "error", message: err instanceof Error ? err.message : "Ошибка сохранения значений страницы" };
  }
}

function errFile(
  originalIndex: number,
  label: string | null,
  fileKind: "entity" | "page",
  targetName: string | null,
  error: string,
  total: number,
): Prepared {
  return { kind: "error", originalIndex, label, fileKind, targetName, error, total };
}

async function prepareEntityFile(
  originalIndex: number,
  f: { label?: string | null; entityId?: number | null; keyFieldKey?: string | null; relationColumns?: { relationId: number; targetKeyFieldKey: string }[]; rows: RowInput[] },
  gdrive: boolean,
): Promise<Prepared> {
  const label = f.label ?? null;
  const total = f.rows.length;
  const entityId = f.entityId ?? null;
  if (entityId == null) return errFile(originalIndex, label, "entity", null, "Не указана сущность", total);
  const [entity] = await db
    .select({ id: entitiesTable.id, nameJson: entitiesTable.nameJson })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!entity) return errFile(originalIndex, label, "entity", null, "Сущность не найдена", total);
  const entityName = mlName(entity.nameJson, String(entityId));

  const fields = await loadActiveFields(entityId);
  const fieldByKey = new Map(fields.map((fl) => [fl.fieldKey, fl]));
  const statuses = await db
    .select()
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.isActive, true)))
    .orderBy(asc(entityStatusesTable.sortOrder));

  const keyFieldKey = f.keyFieldKey ?? null;
  const keyField = keyFieldKey ? fieldByKey.get(keyFieldKey) : undefined;
  if (keyFieldKey && !keyField) {
    return errFile(originalIndex, label, "entity", entityName, `Неизвестное ключевое поле: ${keyFieldKey}`, total);
  }
  const keyFields = fields.filter((fl) => fl.isKey);

  const relations = await db.select().from(relationsTable).where(eq(relationsTable.sourceEntityId, entityId));
  const relById = new Map(relations.map((r) => [r.id, r]));
  const relCols = f.relationColumns ?? [];
  for (const rc of relCols) {
    if (!relById.has(rc.relationId)) {
      return errFile(originalIndex, label, "entity", entityName, `Неизвестная связь: ${rc.relationId}`, total);
    }
  }

  const ctx: EntityCtx = {
    kind: "entity",
    entityId,
    entityName,
    fields,
    fieldByKey,
    statuses,
    gdrive,
    keyField,
    keyFields,
    relCols,
    relById,
  };
  return { kind: "entity", originalIndex, label, ctx, rows: f.rows };
}

async function preparePageFile(
  originalIndex: number,
  f: { label?: string | null; pageId?: number | null; hostKeyFieldKey?: string | null; rows: RowInput[] },
): Promise<Prepared> {
  const label = f.label ?? null;
  const total = f.rows.length;
  const pageId = f.pageId ?? null;
  if (pageId == null) return errFile(originalIndex, label, "page", null, "Не указана страница", total);
  const [page] = await db
    .select({ id: pagesTable.id, nameJson: pagesTable.nameJson })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  if (!page) return errFile(originalIndex, label, "page", null, "Страница не найдена", total);
  const pageName = mlName(page.nameJson, String(pageId));

  const eff = await effectiveEntityForPage(pageId);
  if (!eff.found || !eff.isMirror || eff.entityId == null) {
    return errFile(originalIndex, label, "page", pageName, "Импорт значений доступен только для зеркальных страниц", total);
  }
  const mirrorEntityId = eff.entityId;

  const hostKeyFieldKey = f.hostKeyFieldKey ?? null;
  if (!hostKeyFieldKey) return errFile(originalIndex, label, "page", pageName, "Не указано поле для поиска записи", total);
  const entityFields = await loadActiveFields(mirrorEntityId);
  const hostKeyField = entityFields.find((x) => x.fieldKey === hostKeyFieldKey);
  if (!hostKeyField) {
    return errFile(originalIndex, label, "page", pageName, `Неизвестное поле поиска: ${hostKeyFieldKey}`, total);
  }

  const pageFields = await db
    .select()
    .from(pageFieldsTable)
    .where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true)))
    .orderBy(asc(pageFieldsTable.sortOrder));

  const ctx: PageCtx = { kind: "page", pageId, pageName, mirrorEntityId, hostKeyField, pageFields };
  return { kind: "page", originalIndex, label, ctx, rows: f.rows };
}

/**
 * Order entity files so relation targets are written before their sources
 * (Kahn's algorithm; cycles fall back to original order — unresolved targets
 * then surface as row errors). Page files run after ALL entity files so their
 * host records already exist. Error files keep their original position.
 */
function orderPrepared(prepared: Prepared[]): Prepared[] {
  const entityFiles = prepared.filter((p): p is Extract<Prepared, { kind: "entity" }> => p.kind === "entity");
  const others = prepared.filter((p) => p.kind !== "entity");

  const indeg = new Map<number, number>();
  const outEdges = new Map<number, number[]>(); // target file idx -> [source file idx]
  for (const a of entityFiles) indeg.set(a.originalIndex, 0);
  for (const a of entityFiles) {
    const targetEntityIds = new Set<number>();
    for (const rc of a.ctx.relCols) {
      const rel = a.ctx.relById.get(rc.relationId);
      if (rel) targetEntityIds.add(rel.targetEntityId);
    }
    for (const b of entityFiles) {
      if (b.originalIndex === a.originalIndex) continue;
      if (targetEntityIds.has(b.ctx.entityId)) {
        // b (target) must come before a (source): edge b -> a
        outEdges.set(b.originalIndex, [...(outEdges.get(b.originalIndex) ?? []), a.originalIndex]);
        indeg.set(a.originalIndex, (indeg.get(a.originalIndex) ?? 0) + 1);
      }
    }
  }

  const byIndex = new Map(entityFiles.map((p) => [p.originalIndex, p]));
  const queue = entityFiles.filter((p) => (indeg.get(p.originalIndex) ?? 0) === 0).map((p) => p.originalIndex);
  const sorted: Extract<Prepared, { kind: "entity" }>[] = [];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (seen.has(idx)) continue;
    seen.add(idx);
    sorted.push(byIndex.get(idx)!);
    for (const next of outEdges.get(idx) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  // Cycle fallback: append any entity files not emitted, in original order.
  for (const p of entityFiles) if (!seen.has(p.originalIndex)) sorted.push(p);

  return [...sorted, ...others];
}

async function runBatch(req: Request, res: Response, dryRun: boolean): Promise<void> {
  const body = PreviewImportBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const gdrive = await isGoogleDriveModuleEnabled();

  const prepared: Prepared[] = [];
  for (let i = 0; i < body.data.files.length; i++) {
    const f = body.data.files[i]!;
    prepared.push(f.kind === "entity" ? await prepareEntityFile(i, f, gdrive) : await preparePageFile(i, f));
  }

  const fileResults: FileResult[] = new Array(prepared.length);
  let anyError = false;

  // Seed file-level errors (bad target etc.). These make the batch not-ok, so a
  // commit rolls everything back (all-or-nothing).
  for (const p of prepared) {
    if (p.kind === "error") {
      fileResults[p.originalIndex] = {
        index: p.originalIndex,
        kind: p.fileKind,
        label: p.label,
        targetName: p.targetName,
        error: p.error,
        total: p.total,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        rows: [],
      };
      anyError = true;
    }
  }

  const ordered = orderPrepared(prepared);
  const lockIds = [
    ...new Set(
      ordered.filter((p): p is Extract<Prepared, { kind: "entity" }> => p.kind === "entity").map((p) => p.ctx.entityId),
    ),
  ].sort((a, b) => a - b);

  class Rollback extends Error {}
  const pendingUpdates = new Map<number, ImportRecordUpdate>();
  const pendingCreates = new Map<number, ImportRecordCreate>();
  const pendingPageUpdates = new Map<string, ImportPageUpdate>();
  let committed = false;
  try {
    await db.transaction(async (tx) => {
      // Acquire per-entity advisory locks up front (sorted → deadlock-free) so
      // unique-key checks are serialized for the whole batch's lifetime.
      for (const id of lockIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${id})`);
      }
      for (const p of ordered) {
        if (p.kind === "error") continue;
        const fr: FileResult = {
          index: p.originalIndex,
          kind: p.kind,
          label: p.label,
          targetName: p.kind === "entity" ? p.ctx.entityName : p.ctx.pageName,
          error: null,
          total: p.rows.length,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
          rows: [],
        };
        for (const row of p.rows) {
          const outcome =
            p.kind === "entity"
              ? await processEntityRow(tx, row, p.ctx, req.user!.userId)
              : await processPageRow(tx, row, p.ctx);
          for (const update of outcome.updates ?? []) {
            const created = pendingCreates.get(update.recordId);
            if (created) {
              pendingCreates.set(update.recordId, {
                ...created,
                version: update.version,
                statusId: update.statusId !== undefined ? update.statusId : created.statusId,
                changedFields: [...new Set([...created.changedFields, ...update.changedFields])],
              });
              continue;
            }
            const previous = pendingUpdates.get(update.recordId);
            pendingUpdates.set(update.recordId, {
              ...update,
              changedFields: [...new Set([...(previous?.changedFields ?? []), ...update.changedFields])],
            });
          }
          for (const created of outcome.creates ?? []) {
            const previous = pendingCreates.get(created.recordId);
            pendingCreates.set(created.recordId, {
              ...created,
              changedFields: [
                ...new Set([...(previous?.changedFields ?? []), ...created.changedFields]),
              ],
            });
            // A newly-created source has exactly one semantic create event. Its
            // relation touch must never leak into the update-event collector.
            pendingUpdates.delete(created.recordId);
          }
          for (const update of outcome.pageUpdates ?? []) {
            const key = `${update.pageId}:${update.recordId}`;
            const previous = pendingPageUpdates.get(key);
            pendingPageUpdates.set(key, {
              ...update,
              changedPageFieldKeys: [
                ...new Set([
                  ...(previous?.changedPageFieldKeys ?? []),
                  ...update.changedPageFieldKeys,
                ]),
              ],
            });
          }
          fr.rows.push({ index: row.index, status: outcome.status, message: outcome.message ?? null });
          if (outcome.status === "created") fr.created++;
          else if (outcome.status === "updated") fr.updated++;
          else if (outcome.status === "skipped") fr.skipped++;
          else fr.errors++;
        }
        if (fr.errors > 0) anyError = true;
        fileResults[p.originalIndex] = fr;
      }
      // Preview: always roll back (rehearsal). Commit: roll back if anything failed.
      if (dryRun || anyError) throw new Rollback();
    });
    committed = true;
  } catch (e) {
    if (e instanceof UserReferenceBusyError) {
      res.status(409).json({ error: e.message });
      return;
    }
    if (!(e instanceof Rollback)) {
      req.log?.error({ err: e }, "batch import failed");
      res.status(500).json({ error: e instanceof Error ? e.message : "Ошибка импорта" });
      return;
    }
  }

  if (committed && (pendingCreates.size > 0 || pendingUpdates.size > 0 || pendingPageUpdates.size > 0)) {
    await emitEvent([
      ...[...pendingCreates.values()].map((created) => ({
        eventName: EVENT_RECORD_CREATED,
        entityId: created.entityId,
        recordId: created.recordId,
        payload: {
          actorUserId: req.user!.userId,
          statusId: created.statusId,
          changedFields: created.changedFields,
          version: created.version,
        },
      })),
      ...[...pendingUpdates.values()].map((update) => ({
        eventName: EVENT_RECORD_UPDATED,
        entityId: update.entityId,
        recordId: update.recordId,
        payload: {
          actorUserId: req.user!.userId,
          changedFields: update.changedFields,
          version: update.version,
        },
      })),
      ...[...pendingPageUpdates.values()].map((update) => ({
        eventName: EVENT_PAGE_FIELD_SAVED,
        entityId: update.entityId,
        recordId: update.recordId,
        payload: {
          actorUserId: req.user!.userId,
          pageId: update.pageId,
          changedPageFieldKeys: update.changedPageFieldKeys,
          version: update.version,
        },
      })),
    ], req.log);
  }

  res.json({ ok: !anyError, files: fileResults });
}

router.post("/import/preview", requireAuth, requireAdmin("dataImport"), async (req, res): Promise<void> => {
  await runBatch(req, res, true);
});

router.post("/import/commit", requireAuth, requireAdmin("dataImport"), async (req, res): Promise<void> => {
  await runBatch(req, res, false);
});

export default router;
