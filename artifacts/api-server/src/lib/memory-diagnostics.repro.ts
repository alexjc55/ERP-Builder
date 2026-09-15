import { and, asc, eq, isNull } from "drizzle-orm";
import type { LinkedFormulaPermissionContext } from "./linked-formula-resolver";

interface MemoryUsageSnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

interface ReproductionPoint extends MemoryUsageSnapshot {
  cycle: number;
}

interface RealFixtureResult {
  status: "measured";
  scenario: "real_formula_runtime";
  readOnly: true;
  entityId: number;
  pageId: number;
  rowsPerCycle: number;
  cycles: number;
  entityFieldCount: number;
  pageFieldCount: number;
  gcAvailable: boolean;
  cachePassesPerCycle: number;
  permissionContextsPerCycle: number;
  checksum: number;
  points: ReproductionPoint[];
}

interface UnavailableResult {
  status: "unavailable";
  scenario: "real_formula_runtime";
  readOnly: true;
  reason: string;
  attribution: "none";
}

/**
 * Read-only bounded reproduction of the actual API formula path.
 *
 * The fixture is loaded with SELECTs from the existing development database,
 * then each simulated request creates a fresh permission identity and
 * request-owned cache, runs mergeLinkedFormulaInputs twice (miss + clone-safe
 * hit), and materializes the page formula projection. No INSERT/UPDATE/DELETE
 * is present in this script. Results are dropped between cycles so post-GC
 * trends test request-scope release rather than an intentionally retained
 * object graph.
 */
const FIXTURE_ENTITY_ID = 72;
const FIXTURE_PAGE_ID = 119;
const DEFAULT_ROWS = 100;
const DEFAULT_CYCLES = 10;
const MAX_ROWS = 500;
const MAX_CYCLES = 1_000;

function readMemoryUsage(): MemoryUsageSnapshot {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(maximum, value);
}

function maybeCollect(): boolean {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) return false;
  gc();
  return true;
}

function point(cycle: number): ReproductionPoint {
  return { cycle, ...readMemoryUsage() };
}

function readOnlyPermissionContext(
  systemPermissions: LinkedFormulaPermissionContext,
): LinkedFormulaPermissionContext {
  // Do not reuse one identity across simulated requests: the production cache
  // is intentionally partitioned by permission-context object identity.
  return {
    authorizeResources: (resources) => systemPermissions.authorizeResources(resources),
    filterRows: (scope) => systemPermissions.filterRows(scope),
  };
}

async function runRealFixture(
  rowsPerCycle: number,
  cycles: number,
): Promise<RealFixtureResult> {
  const [{ db, entityFieldsTable, entityRecordsTable, pageFieldsTable, pool }, runtime] =
    await Promise.all([
      import("@workspace/db"),
      import("./formula-runtime"),
    ]);
  const {
    createFormulaDependencyRequestCache,
    materializeVisiblePageFormulas,
    mergeLinkedFormulaInputs,
    systemFormulaPermissions,
  } = runtime;

  try {
    const [entityFields, pageFields, storedRows] = await Promise.all([
      db.select().from(entityFieldsTable).where(and(
        eq(entityFieldsTable.entityId, FIXTURE_ENTITY_ID),
        eq(entityFieldsTable.isActive, true),
      )),
      db.select().from(pageFieldsTable).where(and(
        eq(pageFieldsTable.pageId, FIXTURE_PAGE_ID),
        eq(pageFieldsTable.isActive, true),
      )),
      db.select({
        id: entityRecordsTable.id,
        values: entityRecordsTable.valuesJson,
      })
        .from(entityRecordsTable)
        .where(and(
          eq(entityRecordsTable.entityId, FIXTURE_ENTITY_ID),
          isNull(entityRecordsTable.archivedAt),
        ))
        .orderBy(asc(entityRecordsTable.id))
        .limit(rowsPerCycle),
    ]);
    if (storedRows.length === 0) {
      throw new Error(
        `Read-only fixture has no active rows for entity ${FIXTURE_ENTITY_ID}`,
      );
    }

    const rows = storedRows.map((row) => ({
      id: row.id,
      values: (row.values ?? {}) as Record<string, unknown>,
    }));
    const pageRows = rows.map((row) => ({
      id: row.id,
      entityValues: row.values,
      pageValues: {},
    }));
    const fields = [...entityFields, ...pageFields];
    const points = [point(0)];
    let checksum = 0;

    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const permissions = readOnlyPermissionContext(systemFormulaPermissions);
      const requestCache = createFormulaDependencyRequestCache();
      const options = {
        entityId: FIXTURE_ENTITY_ID,
        pageId: FIXTURE_PAGE_ID,
        rows,
        fields,
        permissions,
        requestCache,
      };

      // First pass resolves linked sources; second pass exercises the
      // request-owned cache and clone-before-use behavior.
      await mergeLinkedFormulaInputs(options);
      const linkedInputs = await mergeLinkedFormulaInputs(options);
      const materialized = materializeVisiblePageFormulas({
        entityId: FIXTURE_ENTITY_ID,
        pageId: FIXTURE_PAGE_ID,
        rows: pageRows,
        entityFields,
        pageFields,
        hiddenEntity: new Set(),
        hiddenPage: new Set(),
        linkedInputs,
        formulaOptions: { now: new Date("2025-01-15T12:00:00Z") },
      });
      checksum += [...linkedInputs.values()]
        .reduce((total, values) => total + Object.keys(values).length, 0);
      checksum += [...materialized.values()]
        .reduce((total, values) => total + Object.keys(values).length, 0);

      // The only references retained by this loop are the fixture rows and
      // metadata. Request cache, permission identity, resolver outputs, and
      // formula projections become unreachable after this iteration.
      maybeCollect();
      points.push(point(cycle));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return {
      status: "measured",
      scenario: "real_formula_runtime",
      readOnly: true,
      entityId: FIXTURE_ENTITY_ID,
      pageId: FIXTURE_PAGE_ID,
      rowsPerCycle: rows.length,
      cycles,
      entityFieldCount: entityFields.length,
      pageFieldCount: pageFields.length,
      gcAvailable: typeof (globalThis as typeof globalThis & { gc?: unknown }).gc === "function",
      cachePassesPerCycle: 2,
      permissionContextsPerCycle: 1,
      checksum,
      points,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<RealFixtureResult | UnavailableResult> {
  if (!process.env.DATABASE_URL) {
    return {
      status: "unavailable",
      scenario: "real_formula_runtime",
      readOnly: true,
      reason: "DATABASE_URL is not set; the real resolver fixture cannot run.",
      attribution: "none",
    };
  }

  const rowsPerCycle = boundedInteger(
    process.env.ERP_MEMORY_REPRO_ROWS,
    DEFAULT_ROWS,
    MAX_ROWS,
  );
  const cycles = boundedInteger(
    process.env.ERP_MEMORY_REPRO_CYCLES,
    DEFAULT_CYCLES,
    MAX_CYCLES,
  );

  try {
    return await runRealFixture(rowsPerCycle, cycles);
  } catch (error) {
    return {
      status: "unavailable",
      scenario: "real_formula_runtime",
      readOnly: true,
      reason: error instanceof Error ? error.message : "The read-only fixture failed.",
      attribution: "none",
    };
  }
}

main()
  .then((result) => console.log(JSON.stringify({
    diagnostic: "formula_memory_reproduction",
    ...result,
    note: result.status === "measured"
      ? "Interpret post-GC trends only; this is a development fixture, not production attribution."
      : "No leak attribution was made because the real read-only fixture was unavailable.",
  })))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });