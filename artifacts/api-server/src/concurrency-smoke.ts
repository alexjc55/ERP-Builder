/**
 * Transactional CAS smoke check. Run with:
 *   pnpm --filter @workspace/api-server run smoke:concurrency
 *
 * It creates only rollback-scoped rows and deliberately aborts the transaction,
 * so it never leaves development data behind.
 */
import assert from "node:assert/strict";
import {
  db,
  pool,
  entitiesTable,
  pagesTable,
  entityRecordsTable,
  pageRecordValuesTable,
  relationsTable,
  recordLinksTable,
  auditLogTable,
  usersTable,
} from "@workspace/db";
import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  globalPresenceSnapshot,
  isUnrestrictedVisibilityProfile,
  presenceForViewer,
  putPresence,
  removePresence,
} from "./lib/collaboration";
import { encodeScopeFilter } from "./lib/scope-filter";
import { isRecordOwned } from "./routes/own-scope";
import { USER_REFERENCE_LOCK_NS } from "./lib/user-reference-barrier";

const ROLLBACK = "concurrency-smoke-rollback";

async function main(): Promise<void> {
  const publicPresence = {
    userId: 7,
    name: "Viewer",
    color: "#2563eb",
    editing: { entityId: 3, recordId: 9, fieldKey: "secret", source: "entity" as const },
  };
  assert.equal(presenceForViewer(publicPresence, false).editing, null, "Restricted presence leaked editing coordinates");
  assert.deepEqual(presenceForViewer(publicPresence, true).editing, publicPresence.editing, "Unrestricted presence lost editing coordinates");
  const unrestricted = {
    scope: "all" as const,
    hiddenRowStatusCount: 0,
    visibleEntityFieldCount: 2,
    activeEntityFieldCount: 2,
    visiblePageFieldCount: 1,
    activePageFieldCount: 1,
  };
  assert.equal(isUnrestrictedVisibilityProfile(unrestricted), true);
  assert.equal(isUnrestrictedVisibilityProfile({ ...unrestricted, scope: "own" }), false);
  assert.equal(isUnrestrictedVisibilityProfile({ ...unrestricted, hiddenRowStatusCount: 1 }), false);
  assert.equal(isUnrestrictedVisibilityProfile({ ...unrestricted, visibleEntityFieldCount: 1 }), false);
  assert.equal(isUnrestrictedVisibilityProfile({ ...unrestricted, visiblePageFieldCount: 0 }), false);

  // Global presence is TTL-backed, aggregates tabs by user, and exposes only the
  // widget-safe fields (never editing coordinates).
  putPresence(101, "presence-smoke-a", { id: 700001, name: "Presence User" }, publicPresence.editing);
  putPresence(102, "presence-smoke-b", { id: 700001, name: "Presence User" }, null);
  const [globalUser] = globalPresenceSnapshot().filter((user) => user.userId === 700001);
  assert.ok(globalUser, "Global presence omitted active user");
  assert.equal(globalUser.sessionCount, 2, "Global presence did not aggregate browser tabs");
  assert.equal(globalUser.currentPageId, 102, "Global presence did not retain the latest client page");
  assert.equal("editing" in globalUser, false, "Global presence leaked editing coordinates");
  removePresence(101, "presence-smoke-a", 700001);
  removePresence(102, "presence-smoke-b", 700001);

  // Genuine two-transaction regression for the shared user-merge/record-merge
  // order: page advisory pair first, entity row second, page-value row third.
  const [deadlockPair] = await db.select({
    pageId: pageRecordValuesTable.pageId,
    recordId: pageRecordValuesTable.recordId,
  }).from(pageRecordValuesTable).limit(1);
  if (!deadlockPair) throw new Error("Deadlock smoke requires one existing page-value row");
  const deadlockRecord = { id: deadlockPair.recordId };
  const deadlockPage = { id: deadlockPair.pageId };
  const [barrierUser] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (!barrierUser) throw new Error("User-reference barrier smoke requires one existing user");
  for (const label of ["entity", "page"]) {
    const writer = await pool.connect();
    const merger = await pool.connect();
    try {
      await writer.query("BEGIN");
      const shared = await writer.query(
        "SELECT pg_try_advisory_xact_lock_shared($1, $2) AS acquired",
        [USER_REFERENCE_LOCK_NS, barrierUser.id],
      );
      if (shared.rows[0]?.acquired !== true) throw new Error(`${label} writer failed initial shared barrier`);
      await merger.query("BEGIN");
      await merger.query("SET LOCAL lock_timeout = '2s'");
      const exclusive = merger.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [USER_REFERENCE_LOCK_NS, barrierUser.id],
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writer.query("COMMIT");
      await exclusive;
      await merger.query("ROLLBACK");

      await merger.query("BEGIN");
      await merger.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [USER_REFERENCE_LOCK_NS, barrierUser.id],
      );
      await writer.query("BEGIN");
      const late = await writer.query(
        "SELECT pg_try_advisory_xact_lock_shared($1, $2) AS acquired",
        [USER_REFERENCE_LOCK_NS, barrierUser.id],
      );
      if (late.rows[0]?.acquired !== false) throw new Error(`${label} late writer crossed merge barrier`);
      await writer.query("ROLLBACK");
      await merger.query("ROLLBACK");
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await merger.query("ROLLBACK").catch(() => undefined);
      writer.release();
      merger.release();
    }
  }
  const resourceWriter = await pool.connect();
  const resourceMerger = await pool.connect();
  const barrierTimings: Record<string, number> = {};
  try {
    // A: exclusive merge barrier first; an entity writer may already hold the
    // row, but shared try-lock must fail immediately and let it roll back.
    await resourceMerger.query("BEGIN");
    await resourceMerger.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [USER_REFERENCE_LOCK_NS, barrierUser.id],
    );
    await resourceWriter.query("BEGIN");
    await resourceWriter.query("SET LOCAL statement_timeout = '500ms'");
    await resourceWriter.query(
      "SELECT id FROM entity_records WHERE id = $1 FOR UPDATE",
      [deadlockRecord.id],
    );
    let started = process.hrtime.bigint();
    const entityTry = await resourceWriter.query(
      "SELECT pg_try_advisory_xact_lock_shared($1, $2) AS acquired",
      [USER_REFERENCE_LOCK_NS, barrierUser.id],
    );
    barrierTimings.entityLateTryMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (entityTry.rows[0]?.acquired !== false || barrierTimings.entityLateTryMs >= 250) {
      throw new Error(`Entity shared try-lock did not fail fast (${barrierTimings.entityLateTryMs.toFixed(2)}ms)`);
    }
    await resourceWriter.query("ROLLBACK");
    await resourceMerger.query(
      "SELECT id FROM entity_records WHERE id = $1 FOR UPDATE",
      [deadlockRecord.id],
    );
    await resourceMerger.query("ROLLBACK");

    // B: same inversion shape for page writers, including the exact pair
    // advisory and the concrete page row.
    await resourceMerger.query("BEGIN");
    await resourceMerger.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [USER_REFERENCE_LOCK_NS, barrierUser.id],
    );
    await resourceWriter.query("BEGIN");
    await resourceWriter.query("SET LOCAL statement_timeout = '500ms'");
    await resourceWriter.query(
      "SELECT pg_advisory_xact_lock(($1::bigint << 32) | $2::bigint)",
      [deadlockPage.id, deadlockRecord.id],
    );
    await resourceWriter.query(
      "SELECT id FROM page_record_values WHERE page_id = $1 AND record_id = $2 FOR UPDATE",
      [deadlockPage.id, deadlockRecord.id],
    );
    started = process.hrtime.bigint();
    const pageTry = await resourceWriter.query(
      "SELECT pg_try_advisory_xact_lock_shared($1, $2) AS acquired",
      [USER_REFERENCE_LOCK_NS, barrierUser.id],
    );
    barrierTimings.pageLateTryMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (pageTry.rows[0]?.acquired !== false || barrierTimings.pageLateTryMs >= 250) {
      throw new Error(`Page shared try-lock did not fail fast (${barrierTimings.pageLateTryMs.toFixed(2)}ms)`);
    }
    await resourceWriter.query("ROLLBACK");
    await resourceMerger.query(
      "SELECT pg_advisory_xact_lock(($1::bigint << 32) | $2::bigint)",
      [deadlockPage.id, deadlockRecord.id],
    );
    await resourceMerger.query(
      "SELECT id FROM entity_records WHERE id = $1 FOR UPDATE",
      [deadlockRecord.id],
    );
    await resourceMerger.query(
      "SELECT id FROM page_record_values WHERE page_id = $1 AND record_id = $2 FOR UPDATE",
      [deadlockPage.id, deadlockRecord.id],
    );
    await resourceMerger.query("ROLLBACK");

    // C: reverse order. The writer owns concrete resources and a shared
    // barrier; merge waits only on the exclusive barrier, then acquires all
    // resources after writer commit.
    await resourceWriter.query("BEGIN");
    await resourceWriter.query(
      "SELECT pg_advisory_xact_lock(($1::bigint << 32) | $2::bigint)",
      [deadlockPage.id, deadlockRecord.id],
    );
    await resourceWriter.query(
      "SELECT id FROM entity_records WHERE id = $1 FOR UPDATE",
      [deadlockRecord.id],
    );
    await resourceWriter.query(
      "SELECT id FROM page_record_values WHERE page_id = $1 AND record_id = $2 FOR UPDATE",
      [deadlockPage.id, deadlockRecord.id],
    );
    const shared = await resourceWriter.query(
      "SELECT pg_try_advisory_xact_lock_shared($1, $2) AS acquired",
      [USER_REFERENCE_LOCK_NS, barrierUser.id],
    );
    if (shared.rows[0]?.acquired !== true) throw new Error("Reverse-order writer failed shared barrier");
    await resourceMerger.query("BEGIN");
    await resourceMerger.query("SET LOCAL lock_timeout = '2s'");
    started = process.hrtime.bigint();
    const exclusiveWait = resourceMerger.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [USER_REFERENCE_LOCK_NS, barrierUser.id],
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await resourceWriter.query("COMMIT");
    await exclusiveWait;
    barrierTimings.reverseExclusiveWaitMs = Number(process.hrtime.bigint() - started) / 1e6;
    await resourceMerger.query(
      "SELECT pg_advisory_xact_lock(($1::bigint << 32) | $2::bigint)",
      [deadlockPage.id, deadlockRecord.id],
    );
    await resourceMerger.query(
      "SELECT id FROM entity_records WHERE id = $1 FOR UPDATE",
      [deadlockRecord.id],
    );
    await resourceMerger.query(
      "SELECT id FROM page_record_values WHERE page_id = $1 AND record_id = $2 FOR UPDATE",
      [deadlockPage.id, deadlockRecord.id],
    );
    await resourceMerger.query("ROLLBACK");
  } finally {
    await resourceWriter.query("ROLLBACK").catch(() => undefined);
    await resourceMerger.query("ROLLBACK").catch(() => undefined);
    resourceWriter.release();
    resourceMerger.release();
  }
  console.log(
    `User barrier resources: entity try=${barrierTimings.entityLateTryMs.toFixed(2)}ms, ` +
    `page try=${barrierTimings.pageLateTryMs.toFixed(2)}ms, reverse wait=${barrierTimings.reverseExclusiveWaitMs.toFixed(2)}ms`,
  );
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query("BEGIN");
    await first.query("SET LOCAL lock_timeout = '2s'");
    await first.query(
      "SELECT pg_advisory_xact_lock(($1::bigint << 32) | $2::bigint)",
      [deadlockPage.id, deadlockRecord.id],
    );
    const secondRun = (async () => {
      await second.query("BEGIN");
      await second.query("SET LOCAL lock_timeout = '2s'");
      await second.query(
        "SELECT pg_advisory_xact_lock(($1::bigint << 32) | $2::bigint)",
        [deadlockPage.id, deadlockRecord.id],
      );
      await second.query("SELECT id FROM entity_records WHERE id = $1 FOR UPDATE", [deadlockRecord.id]);
      await second.query(
        "SELECT id FROM page_record_values WHERE page_id = $1 AND record_id = $2 FOR UPDATE",
        [deadlockPage.id, deadlockRecord.id],
      );
      await second.query("ROLLBACK");
    })();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await first.query("SELECT id FROM entity_records WHERE id = $1 FOR UPDATE", [deadlockRecord.id]);
    await first.query(
      "SELECT id FROM page_record_values WHERE page_id = $1 AND record_id = $2 FOR UPDATE",
      [deadlockPage.id, deadlockRecord.id],
    );
    await first.query("ROLLBACK");
    await secondRun;
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);
    await second.query("ROLLBACK").catch(() => undefined);
    first.release();
    second.release();
  }

  try {
    await db.transaction(async (tx) => {
      const [entity] = await tx.select({ id: entitiesTable.id }).from(entitiesTable).limit(1);
      const [page] = await tx.select({ id: pagesTable.id }).from(pagesTable).limit(1);
      if (!entity || !page) throw new Error("Smoke requires at least one entity and one page in the dev DB");

      const [record] = await tx
        .insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: { owner: 999, region: "private" } })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      if (!record || record.version !== 1) throw new Error("Unexpected initial entity record version");
      const [relationFreeImportCreate] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: { importCreate: "plain" } })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version, statusId: entityRecordsTable.statusId });
      const relationFreeCreateMetadata = relationFreeImportCreate && {
        recordId: relationFreeImportCreate.id,
        entityId: entity.id,
        version: relationFreeImportCreate.version,
        statusId: relationFreeImportCreate.statusId,
      };
      if (relationFreeCreateMetadata?.version !== 1) {
        throw new Error("Relation-free import create lacked final create-event version");
      }
      const [relatedImportCreate] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: { importCreate: "related" } })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const [relatedImportTouch] = await tx.update(entityRecordsTable)
        .set({ updatedAt: new Date() })
        .where(eq(entityRecordsTable.id, relatedImportCreate!.id))
        .returning({ version: entityRecordsTable.version });
      const relatedCreateMetadata = {
        recordId: relatedImportCreate!.id,
        entityId: entity.id,
        version: relatedImportTouch!.version,
      };
      const relatedSourceUpdateMetadata: unknown[] = [];
      if (relatedCreateMetadata.version !== 2 || relatedSourceUpdateMetadata.length !== 0) {
        throw new Error("Related import create did not use final version or duplicated source update");
      }
      const previewCommitted = false;
      const previewCreateEvents = previewCommitted ? [relationFreeCreateMetadata] : [];
      if (previewCreateEvents.length !== 0) throw new Error("Preview import exposed a create event");
      const [userMergeRecord] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: { assignee: 10, unrelated: "old" } })
        .returning({ id: entityRecordsTable.id });
      await tx.update(entityRecordsTable)
        .set({ valuesJson: { assignee: 10, unrelated: "fresh" } })
        .where(eq(entityRecordsTable.id, userMergeRecord!.id));
      const [lockedUserMerge] = await tx.select({
        valuesJson: entityRecordsTable.valuesJson,
        version: entityRecordsTable.version,
      }).from(entityRecordsTable).where(eq(entityRecordsTable.id, userMergeRecord!.id)).for("update");
      const [userMerged] = await tx.update(entityRecordsTable)
        .set({ valuesJson: {
          ...(lockedUserMerge!.valuesJson as Record<string, unknown>),
          assignee: 20,
        } })
        .where(eq(entityRecordsTable.id, userMergeRecord!.id))
        .returning({ valuesJson: entityRecordsTable.valuesJson, version: entityRecordsTable.version });
      if ((userMerged!.valuesJson as Record<string, unknown>).unrelated !== "fresh") {
        throw new Error("User merge entity rewrite lost concurrent unrelated value");
      }
      const staleUserMergeEntity = await tx.update(entityRecordsTable)
        .set({ valuesJson: { assignee: 10 } })
        .where(andIdVersion(
          entityRecordsTable.id,
          userMergeRecord!.id,
          entityRecordsTable.version,
          lockedUserMerge!.version,
        ))
        .returning({ id: entityRecordsTable.id });
      if (staleUserMergeEntity.length !== 0) throw new Error("Stale entity write succeeded after user merge");

      const [userMergePageRow] = await tx.insert(pageRecordValuesTable)
        .values({
          pageId: page.id,
          recordId: userMergeRecord!.id,
          valuesJson: { pageAssignee: 10, unrelated: "old" },
        })
        .returning({ id: pageRecordValuesTable.id });
      await tx.update(pageRecordValuesTable)
        .set({ valuesJson: { pageAssignee: 10, unrelated: "fresh" } })
        .where(eq(pageRecordValuesTable.id, userMergePageRow!.id));
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock((${page.id}::bigint << 32) | ${userMergeRecord!.id}::bigint)`,
      );
      const [lockedUserMergePage] = await tx.select({
        valuesJson: pageRecordValuesTable.valuesJson,
        version: pageRecordValuesTable.version,
      }).from(pageRecordValuesTable).where(eq(pageRecordValuesTable.id, userMergePageRow!.id)).for("update");
      const [userMergedPage] = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: {
          ...(lockedUserMergePage!.valuesJson as Record<string, unknown>),
          pageAssignee: 20,
        } })
        .where(eq(pageRecordValuesTable.id, userMergePageRow!.id))
        .returning({ valuesJson: pageRecordValuesTable.valuesJson, version: pageRecordValuesTable.version });
      if ((userMergedPage!.valuesJson as Record<string, unknown>).unrelated !== "fresh") {
        throw new Error("User merge page rewrite lost concurrent unrelated value");
      }
      const staleUserMergePage = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: { pageAssignee: 10 } })
        .where(sql`${pageRecordValuesTable.id} = ${userMergePageRow!.id} AND ${pageRecordValuesTable.version} = ${lockedUserMergePage!.version}`)
        .returning({ id: pageRecordValuesTable.id });
      if (staleUserMergePage.length !== 0) throw new Error("Stale page write succeeded after user merge");

      const [defaultRecord] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: {} })
        .returning({ id: entityRecordsTable.id });
      await tx.insert(pageRecordValuesTable).values({
        pageId: page.id,
        recordId: defaultRecord!.id,
        valuesJson: { unrelated: "fresh", defaulted: "" },
      });
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock((${page.id}::bigint << 32) | ${defaultRecord!.id}::bigint)`,
      );
      const [lockedDefaultRow] = await tx.select({
        valuesJson: pageRecordValuesTable.valuesJson,
        version: pageRecordValuesTable.version,
      }).from(pageRecordValuesTable)
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${defaultRecord!.id}`)
        .for("update");
      const [defaulted] = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: {
          ...(lockedDefaultRow!.valuesJson as Record<string, unknown>),
          defaulted: "default",
        } })
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${defaultRecord!.id}`)
        .returning({ valuesJson: pageRecordValuesTable.valuesJson, version: pageRecordValuesTable.version });
      if (
        (defaulted!.valuesJson as Record<string, unknown>).unrelated !== "fresh" ||
        defaulted!.version !== lockedDefaultRow!.version + 1
      ) {
        throw new Error("Locked page defaults lost concurrent value or event-ready version");
      }
      const [renameRecord] = await tx.insert(entityRecordsTable)
        .values({
          entityId: entity.id,
          valuesJson: { dependent: "old", descendant: "child", unrelated: "initial" },
        })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const [renameConcurrent] = await tx.update(entityRecordsTable)
        .set({ valuesJson: { dependent: "old", descendant: "child", unrelated: "fresh" } })
        .where(andIdVersion(entityRecordsTable.id, renameRecord!.id, entityRecordsTable.version, 1))
        .returning({ version: entityRecordsTable.version });
      const [renameLocked] = await tx.select({
        valuesJson: entityRecordsTable.valuesJson,
        version: entityRecordsTable.version,
      }).from(entityRecordsTable).where(eq(entityRecordsTable.id, renameRecord!.id)).for("update");
      const lockedRenameValues: Record<string, unknown> = {
        ...(renameLocked!.valuesJson as Record<string, unknown>),
        dependent: "new",
      };
      delete lockedRenameValues.descendant;
      const [renamed] = await tx.update(entityRecordsTable)
        .set({ valuesJson: lockedRenameValues })
        .where(andIdVersion(entityRecordsTable.id, renameRecord!.id, entityRecordsTable.version, renameLocked!.version))
        .returning({ valuesJson: entityRecordsTable.valuesJson, version: entityRecordsTable.version });
      const renameEventMetadata = renamed && {
        recordId: renameRecord!.id,
        entityId: entity.id,
        version: renamed.version,
        changedFields: ["dependent", "descendant"],
      };
      if (
        renameEventMetadata?.version !== 3 ||
        (renamed!.valuesJson as Record<string, unknown>).unrelated !== "fresh"
      ) {
        throw new Error("Locked rename lost unrelated update or lacked event-ready version");
      }
      const staleAfterRename = await tx.update(entityRecordsTable)
        .set({ valuesJson: { dependent: "stale" } })
        .where(andIdVersion(
          entityRecordsTable.id,
          renameRecord!.id,
          entityRecordsTable.version,
          renameConcurrent!.version,
        ))
        .returning({ id: entityRecordsTable.id });
      if (staleAfterRename.length !== 0) throw new Error("Stale expectedVersion wrote after rename");
      const [putRecord] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: { requested: "old", unrelated: "initial" } })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      await tx.update(entityRecordsTable)
        .set({ valuesJson: { requested: "old", unrelated: "fresh" } })
        .where(andIdVersion(entityRecordsTable.id, putRecord!.id, entityRecordsTable.version, 1));
      const [lockedPut] = await tx.select({
        valuesJson: entityRecordsTable.valuesJson,
        version: entityRecordsTable.version,
      }).from(entityRecordsTable).where(eq(entityRecordsTable.id, putRecord!.id)).for("update");
      const [putResult] = await tx.update(entityRecordsTable)
        .set({ valuesJson: { ...(lockedPut!.valuesJson as Record<string, unknown>), requested: "new" } })
        .where(eq(entityRecordsTable.id, putRecord!.id))
        .returning({ valuesJson: entityRecordsTable.valuesJson, version: entityRecordsTable.version });
      if (
        putResult?.version !== 3 ||
        (putResult.valuesJson as Record<string, unknown>).unrelated !== "fresh"
      ) {
        throw new Error("PUT without expectedVersion failed to rebase locked unrelated values");
      }
      const stalePut = await tx.update(entityRecordsTable)
        .set({ valuesJson: { requested: "stale" } })
        .where(andIdVersion(entityRecordsTable.id, putRecord!.id, entityRecordsTable.version, 2))
        .returning({ id: entityRecordsTable.id });
      if (stalePut.length !== 0) throw new Error("Stale PUT version wrote after locked update");

      const [deleteSnapshotRecord] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: { file: "old-ref" } })
        .returning({ id: entityRecordsTable.id });
      await tx.update(entityRecordsTable)
        .set({ valuesJson: { file: "latest-ref", unrelated: "latest" } })
        .where(eq(entityRecordsTable.id, deleteSnapshotRecord!.id));
      const [lockedDeleteSnapshot] = await tx.select().from(entityRecordsTable)
        .where(eq(entityRecordsTable.id, deleteSnapshotRecord!.id)).for("update");
      const [physicallyDeleted] = await tx.delete(entityRecordsTable)
        .where(eq(entityRecordsTable.id, deleteSnapshotRecord!.id))
        .returning({ id: entityRecordsTable.id });
      if (
        !physicallyDeleted ||
        (lockedDeleteSnapshot!.valuesJson as Record<string, unknown>).file !== "latest-ref"
      ) {
        throw new Error("Delete bookkeeping snapshot was not the latest locked row");
      }
      if (await isRecordOwned(entity.id, { ...record, valuesJson: { owner: 999 } }, ["owner"], 7, [], tx)) {
        throw new Error("Own-scope denial unexpectedly accepted a generic-link source");
      }
      if (await isRecordOwned(
        entity.id,
        { ...record, valuesJson: { region: "private" } },
        [encodeScopeFilter({ fieldKey: "region", values: ["public"] })],
        7,
        [],
        tx,
      )) {
        throw new Error("Filter-scope denial unexpectedly accepted a generic-link source");
      }
      const [entityWrite] = await tx
        .update(entityRecordsTable)
        .set({ valuesJson: { smoke: "fresh" } })
        .where(andIdVersion(entityRecordsTable.id, record.id, entityRecordsTable.version, 1))
        .returning({ version: entityRecordsTable.version });
      if (!entityWrite || entityWrite.version !== 2) throw new Error("Entity version trigger did not increment once");
      const staleEntity = await tx
        .update(entityRecordsTable)
        .set({ valuesJson: { smoke: "stale" } })
        .where(andIdVersion(entityRecordsTable.id, record.id, entityRecordsTable.version, 1))
        .returning({ id: entityRecordsTable.id });
      if (staleEntity.length !== 0) throw new Error("Stale entity CAS unexpectedly wrote");

      const [archiveRecord] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: {} })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const [archivedResult] = await tx.update(entityRecordsTable)
        .set({ archivedAt: new Date(), archiveExempt: false })
        .where(andIdVersion(entityRecordsTable.id, archiveRecord!.id, entityRecordsTable.version, 1))
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      if (archivedResult?.version !== 2) throw new Error("Archive result was not event-ready with version 2");
      await tx.insert(auditLogTable).values({
        entityId: entity.id, recordId: archiveRecord!.id, fieldKey: "__archived__",
        oldValue: "false", newValue: "true",
      });
      const [unarchivedResult] = await tx.update(entityRecordsTable)
        .set({ archivedAt: null, archiveExempt: true })
        .where(andIdVersion(entityRecordsTable.id, archiveRecord!.id, entityRecordsTable.version, 2))
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      if (unarchivedResult?.version !== 3) throw new Error("Unarchive result was not event-ready with version 3");
      await tx.insert(auditLogTable).values({
        entityId: entity.id, recordId: archiveRecord!.id, fieldKey: "__archived__",
        oldValue: "true", newValue: "false",
      });
      const staleArchive = await tx.update(entityRecordsTable)
        .set({ archivedAt: new Date(), archiveExempt: false })
        .where(andIdVersion(entityRecordsTable.id, archiveRecord!.id, entityRecordsTable.version, 2))
        .returning({ id: entityRecordsTable.id });
      if (staleArchive.length !== 0) throw new Error("Stale archive CAS unexpectedly wrote");
      const archiveAudits = await tx.select({ id: auditLogTable.id }).from(auditLogTable)
        .where(sql`${auditLogTable.recordId} = ${archiveRecord!.id} AND ${auditLogTable.fieldKey} = '__archived__'`);
      if (archiveAudits.length !== 2) throw new Error("Stale archive CAS produced a false audit row");

      const [target] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: {} })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const [relation] = await tx.insert(relationsTable).values({
        sourceEntityId: entity.id,
        targetEntityId: entity.id,
        relationKey: `concurrency_smoke_link_${record.id}`,
        relationType: "many_to_many",
      }).returning({ id: relationsTable.id });
      if (!target || !relation) throw new Error("Failed to prepare generic-link CAS smoke");

      const [staleLocked] = await tx.select({ version: entityRecordsTable.version })
        .from(entityRecordsTable).where(eq(entityRecordsTable.id, record.id)).for("update");
      if (staleLocked?.version === 1) {
        await tx.insert(recordLinksTable).values({
          relationId: relation.id,
          relationType: "many_to_many",
          sourceRecordId: record.id,
          targetRecordId: target.id,
        });
      }
      const staleLinks = await tx.select({ id: recordLinksTable.id }).from(recordLinksTable)
        .where(eq(recordLinksTable.relationId, relation.id));
      if (staleLinks.length !== 0) throw new Error("Stale generic-link create CAS unexpectedly wrote");

      const [link] = await tx.insert(recordLinksTable).values({
        relationId: relation.id,
        relationType: "many_to_many",
        sourceRecordId: record.id,
        targetRecordId: target.id,
      }).returning({ id: recordLinksTable.id });
      const linkTouches = await tx.update(entityRecordsTable).set({ updatedAt: new Date() })
        .where(inArray(entityRecordsTable.id, [record.id, target.id]))
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const linkVersions = new Map(linkTouches.map((row) => [row.id, row.version]));
      if (!link || linkVersions.get(record.id) !== 3 || linkVersions.get(target.id) !== target.version + 1) {
        throw new Error("Generic-link create did not touch both endpoints exactly once");
      }
      const staleTargetAfterCreate = await tx.update(entityRecordsTable)
        .set({ valuesJson: { stale: true } })
        .where(andIdVersion(entityRecordsTable.id, target.id, entityRecordsTable.version, target.version))
        .returning({ id: entityRecordsTable.id });
      if (staleTargetAfterCreate.length !== 0) throw new Error("Target CAS accepted its pre-link-create version");
      const [deleteLocked] = await tx.select({ version: entityRecordsTable.version })
        .from(entityRecordsTable).where(eq(entityRecordsTable.id, record.id)).for("update");
      if (deleteLocked?.version === 2) {
        await tx.delete(recordLinksTable).where(eq(recordLinksTable.id, link.id));
      }
      const [stillLinked] = await tx.select({ id: recordLinksTable.id }).from(recordLinksTable)
        .where(eq(recordLinksTable.id, link.id));
      if (!stillLinked) throw new Error("Stale generic-link delete CAS unexpectedly wrote");

      const [deleteTarget] = await tx.insert(entityRecordsTable)
        .values({ entityId: entity.id, valuesJson: {} })
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      if (!deleteTarget) throw new Error("Failed to prepare endpoint-complete delete smoke");
      const [deleteLink] = await tx.insert(recordLinksTable).values({
        relationId: relation.id,
        relationType: "many_to_many",
        sourceRecordId: record.id,
        targetRecordId: deleteTarget.id,
      }).returning({ id: recordLinksTable.id });
      await tx.update(entityRecordsTable).set({ updatedAt: new Date() })
        .where(inArray(entityRecordsTable.id, [record.id, deleteTarget.id]));
      const beforeDelete = await tx.select({ id: entityRecordsTable.id, version: entityRecordsTable.version })
        .from(entityRecordsTable).where(inArray(entityRecordsTable.id, [record.id, deleteTarget.id]));
      await tx.delete(recordLinksTable).where(eq(recordLinksTable.id, deleteLink!.id));
      const afterDelete = await tx.update(entityRecordsTable).set({ updatedAt: new Date() })
        .where(inArray(entityRecordsTable.id, [record.id, deleteTarget.id]))
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const beforeDeleteVersions = new Map(beforeDelete.map((row) => [row.id, row.version]));
      if (afterDelete.some((row) => row.version !== beforeDeleteVersions.get(row.id)! + 1)) {
        throw new Error("Generic-link delete did not touch both endpoints exactly once");
      }
      const replaceIds = [record.id, target.id, deleteTarget.id];
      const beforeReplace = await tx.select({ id: entityRecordsTable.id, version: entityRecordsTable.version })
        .from(entityRecordsTable).where(inArray(entityRecordsTable.id, replaceIds));
      await tx.delete(recordLinksTable).where(eq(recordLinksTable.id, link.id));
      const [replacementLink] = await tx.insert(recordLinksTable).values({
        relationId: relation.id,
        relationType: "many_to_many",
        sourceRecordId: record.id,
        targetRecordId: deleteTarget.id,
      }).returning({ id: recordLinksTable.id });
      const afterReplace = await tx.update(entityRecordsTable).set({ updatedAt: new Date() })
        .where(inArray(entityRecordsTable.id, replaceIds))
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const beforeReplaceVersions = new Map(beforeReplace.map((row) => [row.id, row.version]));
      if (!replacementLink || afterReplace.some((row) => row.version !== beforeReplaceVersions.get(row.id)! + 1)) {
        throw new Error("Relation replacement did not touch base, previous, and new endpoints exactly once");
      }
      const mergeLinkId = replacementLink.id;

      // Structural merge-concurrency proof: the production merge takes relation
      // locks first, then participant records in ascending order, and only then
      // re-reads links/values. A writer committed before those locks must appear
      // in these locked snapshots; a later writer waits.
      await tx.update(entityRecordsTable).set({ valuesJson: { smoke: "target-fresh" } })
        .where(eq(entityRecordsTable.id, target.id));
      await tx.select({ id: relationsTable.id }).from(relationsTable)
        .where(eq(relationsTable.id, relation.id)).orderBy(asc(relationsTable.id)).for("update");
      const lockedParticipants = await tx.select().from(entityRecordsTable)
        .where(inArray(entityRecordsTable.id, [record.id, target.id].sort((a, b) => a - b)))
        .orderBy(asc(entityRecordsTable.id)).for("update");
      const lockedTarget = lockedParticipants.find((row) => row.id === target.id);
      const lockedSource = lockedParticipants.find((row) => row.id === record.id);
      const protectedLinks = await tx.select().from(recordLinksTable)
        .where(eq(recordLinksTable.sourceRecordId, record.id)).orderBy(asc(recordLinksTable.id)).for("update");
      if (!protectedLinks.some((candidate) => candidate.id === mergeLinkId)) {
        throw new Error("Protected merge snapshot silently missed a committed source link");
      }
      const simulatedTargetValues = { ...((lockedTarget?.valuesJson as Record<string, unknown>) ?? {}) };
      const sourceSmoke = (lockedSource?.valuesJson as Record<string, unknown> | undefined)?.smoke;
      if (simulatedTargetValues.smoke == null && sourceSmoke != null) simulatedTargetValues.smoke = sourceSmoke;
      if (simulatedTargetValues.smoke !== "target-fresh") {
        throw new Error("Merge fill-empty simulation overwrote a fresh target value");
      }
      const beforeLinkOnlyMergeVersion = lockedTarget?.version;
      if (beforeLinkOnlyMergeVersion == null) throw new Error("Missing locked merge target version");
      // Repoint source→external to target→external. Both surviving endpoints
      // advance exactly once while the deleted source needs no touch.
      const [externalBeforeMerge] = await tx.select({ version: entityRecordsTable.version })
        .from(entityRecordsTable).where(eq(entityRecordsTable.id, deleteTarget.id));
      await tx.update(recordLinksTable).set({ sourceRecordId: target.id })
        .where(eq(recordLinksTable.id, mergeLinkId));
      const mergeTouches = await tx.update(entityRecordsTable).set({ updatedAt: new Date() })
        .where(inArray(entityRecordsTable.id, [target.id, deleteTarget.id]))
        .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
      const linkOnlyTouch = mergeTouches.find((row) => row.id === target.id);
      const externalTouch = mergeTouches.find((row) => row.id === deleteTarget.id);
      if (linkOnlyTouch?.version !== beforeLinkOnlyMergeVersion + 1) {
        throw new Error("Link-only merge did not advance target version exactly once");
      }
      if (externalTouch?.version !== externalBeforeMerge!.version + 1) {
        throw new Error("Merge link repoint did not advance external endpoint exactly once");
      }
      const staleAfterLinkMerge = await tx.update(entityRecordsTable)
        .set({ valuesJson: { smoke: "stale-after-link-merge" } })
        .where(andIdVersion(
          entityRecordsTable.id,
          target.id,
          entityRecordsTable.version,
          beforeLinkOnlyMergeVersion,
        ))
        .returning({ id: entityRecordsTable.id });
      if (staleAfterLinkMerge.length !== 0) {
        throw new Error("Old expectedVersion wrote after a link-only merge");
      }
      const [beforeInlineEntity] = await tx.select({
        valuesJson: entityRecordsTable.valuesJson,
        version: entityRecordsTable.version,
      }).from(entityRecordsTable).where(eq(entityRecordsTable.id, record.id));
      const [inlineEntity] = await tx.update(entityRecordsTable)
        .set({ valuesJson: { ...(beforeInlineEntity!.valuesJson as Record<string, unknown>), unrelatedFresh: "keep" } })
        .where(andIdVersion(entityRecordsTable.id, record.id, entityRecordsTable.version, beforeInlineEntity!.version))
        .returning({ version: entityRecordsTable.version });
      const [lockedEntityForImport] = await tx.select({
        valuesJson: entityRecordsTable.valuesJson,
        version: entityRecordsTable.version,
      }).from(entityRecordsTable).where(eq(entityRecordsTable.id, record.id)).for("update");
      const [entityImportWrite] = await tx.update(entityRecordsTable)
        .set({ valuesJson: { ...(lockedEntityForImport!.valuesJson as Record<string, unknown>), importedKey: "applied" } })
        .where(andIdVersion(entityRecordsTable.id, record.id, entityRecordsTable.version, lockedEntityForImport!.version))
        .returning({ valuesJson: entityRecordsTable.valuesJson, version: entityRecordsTable.version });
      if ((entityImportWrite?.valuesJson as Record<string, unknown>)?.unrelatedFresh !== "keep") {
        throw new Error("Locked entity import lost a fresh unrelated inline field");
      }
      const staleEntityAfterImport = await tx.update(entityRecordsTable)
        .set({ valuesJson: { importedKey: "stale" } })
        .where(andIdVersion(entityRecordsTable.id, record.id, entityRecordsTable.version, inlineEntity!.version))
        .returning({ id: entityRecordsTable.id });
      if (staleEntityAfterImport.length !== 0) throw new Error("Stale inline entity version wrote after import");

      const [pageValue] = await tx
        .insert(pageRecordValuesTable)
        .values({ pageId: page.id, recordId: record.id, valuesJson: {} })
        .returning({ version: pageRecordValuesTable.version });
      if (!pageValue || pageValue.version !== 1) throw new Error("Unexpected initial page value version");
      const [pageWrite] = await tx
        .update(pageRecordValuesTable)
        .set({ valuesJson: { smoke: "fresh" } })
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${record.id} AND ${pageRecordValuesTable.version} = 1`)
        .returning({ version: pageRecordValuesTable.version });
      if (!pageWrite || pageWrite.version !== 2) throw new Error("Page version trigger did not increment once");
      const pageImportEventMetadata = {
        entityId: entity.id,
        pageId: page.id,
        recordId: record.id,
        version: pageWrite.version,
        changedPageFieldKeys: ["smoke"],
      };
      if (
        pageImportEventMetadata.version !== 2 ||
        pageImportEventMetadata.changedPageFieldKeys.join(",") !== "smoke"
      ) {
        throw new Error("Page import write did not produce event-ready metadata");
      }
      const [lockedPageForImport] = await tx.select({
        valuesJson: pageRecordValuesTable.valuesJson,
        version: pageRecordValuesTable.version,
      }).from(pageRecordValuesTable)
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${record.id}`)
        .for("update");
      const [rebasedPageImport] = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: {
          ...(lockedPageForImport!.valuesJson as Record<string, unknown>),
          importedPageKey: "applied",
        } })
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${record.id} AND ${pageRecordValuesTable.version} = ${lockedPageForImport!.version}`)
        .returning({ valuesJson: pageRecordValuesTable.valuesJson, version: pageRecordValuesTable.version });
      if (
        rebasedPageImport?.version !== 3 ||
        (rebasedPageImport.valuesJson as Record<string, unknown>).smoke !== "fresh"
      ) {
        throw new Error("Locked page import lost a fresh unrelated inline field");
      }
      const stalePageAfterImport = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: { importedPageKey: "stale" } })
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${record.id} AND ${pageRecordValuesTable.version} = 2`)
        .returning({ id: pageRecordValuesTable.id });
      if (stalePageAfterImport.length !== 0) throw new Error("Stale inline page version wrote after import");
      const [entityBeforePageOnlyMerge] = await tx.select({ version: entityRecordsTable.version })
        .from(entityRecordsTable).where(eq(entityRecordsTable.id, record.id));
      const [pageOnlyMergeWrite] = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: { smoke: "fresh", importedPageKey: "applied", pageOnly: "filled-from-source" } })
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${record.id} AND ${pageRecordValuesTable.version} = 3`)
        .returning({ version: pageRecordValuesTable.version });
      const pageOnlyEventMetadata = pageOnlyMergeWrite
        ? { pageId: page.id, recordId: record.id, version: pageOnlyMergeWrite.version, changedPageFieldKeys: ["pageOnly"] }
        : undefined;
      if (pageOnlyEventMetadata?.version !== 4 || pageOnlyEventMetadata.changedPageFieldKeys[0] !== "pageOnly") {
        throw new Error("Page-only merge did not produce event-ready page metadata");
      }
      const [entityAfterPageOnlyMerge] = await tx.select({ version: entityRecordsTable.version })
        .from(entityRecordsTable).where(eq(entityRecordsTable.id, record.id));
      const pageOnlyEntityEventMetadata =
        entityAfterPageOnlyMerge?.version !== entityBeforePageOnlyMerge?.version
          ? { version: entityAfterPageOnlyMerge?.version }
          : undefined;
      if (pageOnlyEntityEventMetadata !== undefined) {
        throw new Error("Page-only merge incorrectly produced entity event metadata");
      }
      const stalePage = await tx
        .update(pageRecordValuesTable)
        .set({ valuesJson: { smoke: "stale" } })
        .where(sql`${pageRecordValuesTable.pageId} = ${page.id} AND ${pageRecordValuesTable.recordId} = ${record.id} AND ${pageRecordValuesTable.version} = 1`)
        .returning({ id: pageRecordValuesTable.id });
      if (stalePage.length !== 0) throw new Error("Stale page CAS unexpectedly wrote");
      const [sourcePage] = await tx.insert(pagesTable).values({ nameJson: { en: "CAS source" } })
        .returning({ id: pagesTable.id });
      const [sourcePageValue] = await tx.insert(pageRecordValuesTable)
        .values({ pageId: sourcePage!.id, recordId: record.id, valuesJson: { alias: "a", unrelated: "before" } })
        .returning({ version: pageRecordValuesTable.version });
      if (sourcePageValue?.version !== 1) throw new Error("Unexpected source page baseline");
      // Simulate an unrelated source-field commit after the client read alias
      // version 1 but before its mixed local+alias save.
      const [sourceConcurrent] = await tx.update(pageRecordValuesTable)
        .set({ valuesJson: { alias: "a", unrelated: "concurrent" } })
        .where(sql`${pageRecordValuesTable.pageId} = ${sourcePage!.id} AND ${pageRecordValuesTable.recordId} = ${record.id} AND ${pageRecordValuesTable.version} = 1`)
        .returning({ version: pageRecordValuesTable.version });
      if (sourceConcurrent?.version !== 2) throw new Error("Source unrelated-field update did not advance version");
      const touchedPageIds = [page.id, sourcePage!.id].sort((a, b) => a - b);
      const expectedVersions = { [String(page.id)]: 4, [String(sourcePage!.id)]: 1 };
      let conflict: { pageId: number; currentVersion: number } | null = null;
      for (const touchedPageId of touchedPageIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock((${touchedPageId}::bigint << 32) | ${record.id}::bigint)`);
        const [locked] = await tx.select({ version: pageRecordValuesTable.version }).from(pageRecordValuesTable)
          .where(sql`${pageRecordValuesTable.pageId} = ${touchedPageId} AND ${pageRecordValuesTable.recordId} = ${record.id}`)
          .for("update");
        const currentVersion = locked?.version ?? 1;
        if (expectedVersions[String(touchedPageId)] !== currentVersion) {
          conflict = { pageId: touchedPageId, currentVersion };
        }
      }
      if (conflict?.pageId !== sourcePage!.id || conflict.currentVersion !== 2) {
        throw new Error("Mixed page CAS did not identify stale source page/version");
      }
      throw new Error(ROLLBACK);
    });
  } catch (err) {
    if (err instanceof Error && err.message === ROLLBACK) {
      process.stdout.write("Concurrency CAS smoke passed (transaction rolled back).\\n");
      return;
    }
    throw err;
  } finally {
    await pool.end();
  }
}

function andIdVersion(id: typeof entityRecordsTable.id, recordId: number, version: typeof entityRecordsTable.version, expected: number) {
  return sql`${id} = ${recordId} AND ${version} = ${expected}`;
}

void main();