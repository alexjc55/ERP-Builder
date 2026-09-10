import { expect, test, type Browser, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, or } from "drizzle-orm";
import {
  db,
  entityFieldsTable,
  loginHistoryTable,
  NO_ACCESS_PERMS,
  pageFieldsTable,
  pagesTable,
  pool,
  relationsTable,
  rolesTable,
  usersTable,
} from "@workspace/db";

const enabled = process.env.RUN_PAGE_LOAD_PROFILE === "1";
const runId = `${process.pid}-${Date.now()}`;
const email = `page-load-profile-${runId}@example.test`;
const password = randomBytes(32).toString("base64url");
const targetPageIds = [119, 65] as const;

const fixture = {
  roleId: 0,
  userId: 0,
  pages: [] as Array<{ id: number; path: string }>,
};

type RequestMeasure = {
  method: string;
  path: string;
  startedAt: number;
  responseAt?: number;
  finishedAt?: number;
  status?: number;
};

type BrowserProfile = {
  commits: Array<{ at: number; duration: number }>;
  longTasks: Array<{ at: number; duration: number }>;
  firstTableAt: number | null;
  firstCellAt: number | null;
};

type BrowserResource = {
  name: string;
  startTime: number;
  responseStart: number;
  responseEnd: number;
  duration: number;
};

const measuredBaseline = {
  119: {
    firstTableAtMs: 10237.4,
    recordQueryCount: 3,
    reactCommitCount: 53,
    reactCommitDurationMs: 16627.3,
    longTaskDurationMs: 28292,
  },
  65: {
    firstTableAtMs: 10588.3,
    recordQueryCount: 4,
    reactCommitCount: 45,
    reactCommitDurationMs: 14246.3,
    longTaskDurationMs: 23306,
  },
} as const;

test.skip(!enabled, "Set RUN_PAGE_LOAD_PROFILE=1 to use the isolated read-only profiling identity");

test.beforeAll(async () => {
  const targetPages = await db
    .select({
      id: pagesTable.id,
      path: pagesTable.path,
      mirrorEntityId: pagesTable.mirrorEntityId,
      pivotEntityId: pagesTable.pivotEntityId,
    })
    .from(pagesTable)
    .where(inArray(pagesTable.id, [...targetPageIds]));
  fixture.pages = targetPages
    .filter((page) => typeof page.path === "string")
    .map((page) => ({ id: page.id, path: page.path! }))
    .sort((a, b) => targetPageIds.indexOf(a.id as 119 | 65) - targetPageIds.indexOf(b.id as 119 | 65));
  if (fixture.pages.length !== targetPageIds.length) {
    throw new Error("Profiling target pages 119 and 65 must exist and have paths");
  }

  const targetPageFields = await db
    .select({
      relationConfigJson: pageFieldsTable.relationConfigJson,
      pageRefConfigJson: pageFieldsTable.pageRefConfigJson,
    })
    .from(pageFieldsTable)
    .where(inArray(pageFieldsTable.pageId, [...targetPageIds]));
  const requiredPageIds = new Set<number>(targetPageIds);
  const configuredRelationIds = new Set<number>();
  for (const field of targetPageFields) {
    const sourcePageId = field.pageRefConfigJson?.sourcePageId;
    if (typeof sourcePageId === "number") requiredPageIds.add(sourcePageId);
    const relationId = field.relationConfigJson?.relationId;
    if (typeof relationId === "number") configuredRelationIds.add(relationId);
  }
  const requiredPages = await db
    .select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId, pivotEntityId: pagesTable.pivotEntityId })
    .from(pagesTable)
    .where(inArray(pagesTable.id, [...requiredPageIds]));
  const baseEntityIds = new Set<number>();
  for (const page of requiredPages) {
    if (typeof page.mirrorEntityId === "number") baseEntityIds.add(page.mirrorEntityId);
    if (typeof page.pivotEntityId === "number") baseEntityIds.add(page.pivotEntityId);
  }
  const baseFields = baseEntityIds.size > 0
    ? await db
        .select({ relationConfigJson: entityFieldsTable.relationConfigJson })
        .from(entityFieldsTable)
        .where(inArray(entityFieldsTable.entityId, [...baseEntityIds]))
    : [];
  for (const field of baseFields) {
    const relationId = field.relationConfigJson?.relationId;
    if (typeof relationId === "number") configuredRelationIds.add(relationId);
  }
  const relevantRelations = configuredRelationIds.size > 0
    ? await db
        .select({
          sourceEntityId: relationsTable.sourceEntityId,
          targetEntityId: relationsTable.targetEntityId,
        })
        .from(relationsTable)
        .where(inArray(relationsTable.id, [...configuredRelationIds]))
    : baseEntityIds.size > 0
      ? await db
          .select({
            sourceEntityId: relationsTable.sourceEntityId,
            targetEntityId: relationsTable.targetEntityId,
          })
          .from(relationsTable)
          .where(
            or(
              inArray(relationsTable.sourceEntityId, [...baseEntityIds]),
              inArray(relationsTable.targetEntityId, [...baseEntityIds]),
            ),
          )
      : [];
  const permittedEntityIds = new Set(baseEntityIds);
  for (const relation of relevantRelations) {
    permittedEntityIds.add(relation.sourceEntityId);
    permittedEntityIds.add(relation.targetEntityId);
  }
  const readOnlyRecordPerms = Object.fromEntries(
    [...permittedEntityIds].map((entityId) => [
      String(entityId),
      { view: true, create: false, update: false, delete: false, scope: "all" as const },
    ]),
  );
  const [role] = await db
    .insert(rolesTable)
    .values({
      nameJson: { en: `Page load profile ${runId}` },
      permissionsJson: {
        ...NO_ACCESS_PERMS,
        pageIds: [...requiredPageIds],
        records: readOnlyRecordPerms,
      },
    })
    .returning({ id: rolesTable.id });
  fixture.roleId = role!.id;

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      firstName: "Read-only",
      lastName: "Profiler",
      roleId: role!.id,
      language: "ru",
    })
    .returning({ id: usersTable.id });
  fixture.userId = user!.id;
});

test.afterAll(async () => {
  const cleanupErrors: unknown[] = [];
  try {
    if (fixture.userId > 0) {
      try {
        await db.delete(loginHistoryTable).where(eq(loginHistoryTable.userId, fixture.userId));
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await db.delete(usersTable).where(eq(usersTable.id, fixture.userId));
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (fixture.roleId > 0) {
      try {
        await db.delete(rolesTable).where(eq(rolesTable.id, fixture.roleId));
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  } finally {
    await pool.end();
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Failed to fully clean page-load profiling identity");
  }
});

async function authenticatedStorageState(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Пароль|Password/).fill(password);
  await page.getByRole("button", { name: /Войти|Sign in|Login/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const state = await context.storageState();
  await context.close();
  return state;
}

async function installBrowserProfiler(page: Page) {
  await page.addInitScript(() => {
    const profile: BrowserProfile = {
      commits: [],
      longTasks: [],
      firstTableAt: null,
      firstCellAt: null,
    };
    Object.defineProperty(window, "__PAGE_LOAD_PROFILE__", {
      value: profile,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    let nextRendererId = 0;
    const renderers = new Map<number, unknown>();
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      value: {
        supportsFiber: true,
        renderers,
        inject: (renderer: unknown) => {
          const id = ++nextRendererId;
          renderers.set(id, renderer);
          return id;
        },
        onScheduleFiberRoot: () => undefined,
        onCommitFiberRoot: (_rendererId: number, root: { current?: { actualDuration?: number } }) => {
          profile.commits.push({
            at: performance.now(),
            duration: Math.max(0, Number(root.current?.actualDuration) || 0),
          });
        },
        onCommitFiberUnmount: () => undefined,
      },
      configurable: true,
    });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        profile.longTasks.push({ at: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });

    const observePaint = () => {
      const mark = () => {
        if (profile.firstTableAt == null && document.querySelector("main table")) {
          profile.firstTableAt = performance.now();
        }
        if (profile.firstCellAt == null && document.querySelector('[data-testid="record-cell"]')) {
          profile.firstCellAt = performance.now();
        }
      };
      mark();
      new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observePaint();
    else document.addEventListener("DOMContentLoaded", observePaint, { once: true });
  });
}

function normalizedApiPath(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function isReadOnlyApiRequest(method: string, url: string) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const path = new URL(url).pathname;
  if (method === "PUT" && /^\/api\/collaboration\/pages\/\d+\/presence$/.test(path)) {
    return true;
  }
  if (method !== "POST") return false;
  return (
    path.endsWith("/records/query") ||
    path.endsWith("/record-values/query") ||
    path.endsWith("/related-values") ||
    path.endsWith("/filter-values") ||
    path.endsWith("/page-filter-values")
  );
}

function isProjectionRequest(method: string, url: string) {
  if (method !== "POST") return false;
  const path = new URL(url).pathname;
  return path.endsWith("/record-values/query") || path.endsWith("/related-values");
}

test("actual cold loads for pages 119 and 65", async ({ browser }) => {
  test.setTimeout(180_000);
  const storageState = await authenticatedStorageState(browser);
  const reports: Array<Record<string, unknown>> = [];

  for (const target of fixture.pages) {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await installBrowserProfiler(page);

    const requests: RequestMeasure[] = [];
    const byRequest = new Map<object, RequestMeasure>();
    const browserErrors: string[] = [];
    const blockedWrites: string[] = [];
    const startedAt = Date.now();
    let holdNextActiveRecordQuery = false;
    let releaseHeldRecordQuery!: () => void;
    const heldRecordQueryGate = new Promise<void>((resolve) => {
      releaseHeldRecordQuery = resolve;
    });
    let markRecordQueryHeld!: () => void;
    const recordQueryHeld = new Promise<void>((resolve) => {
      markRecordQueryHeld = resolve;
    });

    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().includes("/api/")) return;
      const measure: RequestMeasure = {
        method: request.method(),
        path: normalizedApiPath(request.url()),
        startedAt: Date.now() - startedAt,
      };
      requests.push(measure);
      byRequest.set(request, measure);
    });
    page.on("response", (response) => {
      const measure = byRequest.get(response.request());
      if (!measure) return;
      measure.responseAt = Date.now() - startedAt;
      measure.status = response.status();
    });
    page.on("requestfinished", (request) => {
      const measure = byRequest.get(request);
      if (measure) measure.finishedAt = Date.now() - startedAt;
    });

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      if (isReadOnlyApiRequest(request.method(), request.url())) {
        if (
          holdNextActiveRecordQuery &&
          request.method() === "POST" &&
          new URL(request.url()).pathname.endsWith("/records/query") &&
          request.postDataJSON()?.archived === "active"
        ) {
          holdNextActiveRecordQuery = false;
          markRecordQueryHeld();
          await heldRecordQueryGate;
        }
        await route.continue();
        return;
      }
      blockedWrites.push(`${request.method()} ${normalizedApiPath(request.url())}`);
      await route.abort("blockedbyclient");
    });

    await page.goto(target.path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`${target.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2_000);

    const { browserProfile, timeOrigin, resources } = await page.evaluate(() => ({
      browserProfile:
        (window as typeof window & { __PAGE_LOAD_PROFILE__: BrowserProfile }).__PAGE_LOAD_PROFILE__,
      timeOrigin: performance.timeOrigin,
      resources: performance.getEntriesByType("resource").map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          name: resource.name,
          startTime: resource.startTime,
          responseStart: resource.responseStart,
          responseEnd: resource.responseEnd,
          duration: resource.duration,
        };
      }) satisfies BrowserResource[],
    }));
    const apiRequests = requests.filter((request) => request.path.startsWith("/api/"));
    const recordQueries = apiRequests.filter(
      (request) => request.method === "POST" && request.path.includes("/records/query"),
    );
    const firstQuery = recordQueries[0];
    const browserRecordQueries = resources.filter(
      (resource) => new URL(resource.name).pathname.endsWith("/records/query"),
    );
    const firstBrowserQuery = browserRecordQueries[0];
    expect(recordQueries).toHaveLength(1);
    expect(browserRecordQueries).toHaveLength(1);
    expect(browserProfile.firstTableAt).not.toBeNull();
    expect(firstBrowserQuery?.responseEnd).toBeGreaterThan(0);
    const responseToTableMs =
      browserProfile.firstTableAt! - firstBrowserQuery!.responseEnd;
    expect(responseToTableMs).toBeGreaterThanOrEqual(0);
    const browserFollowUps = resources.filter((resource) => {
      const path = new URL(resource.name).pathname;
      return (
        resource.startTime >= (firstBrowserQuery?.responseEnd ?? Number.POSITIVE_INFINITY) &&
        (path.includes("/record-values") || path.includes("/related-values"))
      );
    });
    const requestCounts = Object.fromEntries(
      [...new Set(apiRequests.map((request) => `${request.method} ${request.path.replace(/\?.*$/, "")}`))]
        .sort()
        .map((key) => [key, apiRequests.filter((request) => `${request.method} ${request.path.replace(/\?.*$/, "")}` === key).length]),
    );

    reports.push({
      pageId: target.id,
      path: target.path,
      browserTimeOrigin: timeOrigin,
      firstTableAtMs: browserProfile.firstTableAt,
      firstCellAtMs: browserProfile.firstCellAt,
      recordResponseToTableMs: Number(responseToTableMs.toFixed(1)),
      reactCommitCount: browserProfile.commits.length,
      reactCommitDurationMs: Number(
        browserProfile.commits.reduce((sum, commit) => sum + commit.duration, 0).toFixed(1),
      ),
      longestReactCommitMs: Number(
        Math.max(0, ...browserProfile.commits.map((commit) => commit.duration)).toFixed(1),
      ),
      longTaskCount: browserProfile.longTasks.length,
      longTaskDurationMs: Number(
        browserProfile.longTasks.reduce((sum, task) => sum + task.duration, 0).toFixed(1),
      ),
      recordQueryCount: recordQueries.length,
      firstRecordQuery: firstQuery,
      browserRecordQuery: firstBrowserQuery,
      followUpsAfterFirstQueryResponse: browserFollowUps.map((resource) => ({
        path: normalizedApiPath(resource.name),
        delayMs: Number((resource.startTime - firstBrowserQuery!.responseEnd).toFixed(1)),
        durationMs: Number(resource.duration.toFixed(1)),
      })),
      requestCounts,
      waterfall: apiRequests,
      blockedWrites,
      browserErrors,
    });

    expect(blockedWrites).toEqual([]);

    // A user filter must produce one scoped query, and manual refresh must keep
    // that filter instead of reverting to the page bootstrap query.
    const search = page.getByPlaceholder(/Поиск|Search/).first();
    const searchTerm = `__read_only_profile_${target.id}_${runId}`;
    const currentRecordQueryCount = () =>
      requests.filter(
        (request) => request.method === "POST" && request.path.includes("/records/query"),
      ).length;
    const beforeFilterQueries = currentRecordQueryCount();
    const filteredResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
      return response.request().postDataJSON()?.search === searchTerm;
    });
    await search.fill(searchTerm);
    await filteredResponse;
    await page.waitForTimeout(700);
    expect(currentRecordQueryCount() - beforeFilterQueries).toBe(1);

    const beforeRefreshQueries = currentRecordQueryCount();
    const refreshResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
      return response.request().postDataJSON()?.search === searchTerm;
    });
    await page.getByTestId("button-refresh-data-desktop").click();
    await refreshResponse;
    await page.waitForTimeout(300);
    expect(currentRecordQueryCount() - beforeRefreshQueries).toBe(1);

    if (target.id === 65) {
      // Supersede a held manual refresh with an archive-scope query. Releasing
      // the old request must not cancel the newer query or arm a global skip.
      holdNextActiveRecordQuery = true;
      await page.getByTestId("button-refresh-data-desktop").click();
      await recordQueryHeld;
      const archivedResponse = page.waitForResponse((response) => {
        if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
        return response.request().postDataJSON()?.archived === "archived";
      });
      await page.getByRole("button", { name: /Архив|Archived/, exact: true }).click();
      await archivedResponse;
      releaseHeldRecordQuery();
      await expect(page.getByTestId("button-refresh-data-desktop")).toBeEnabled();

      const archivedRefresh = page.waitForResponse((response) => {
        if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
        const body = response.request().postDataJSON();
        return body?.archived === "archived" && body?.search === searchTerm;
      });
      await page.getByTestId("button-refresh-data-desktop").click();
      await archivedRefresh;
      await expect(page.locator("main table").first()).toBeVisible();
    }

    releaseHeldRecordQuery();
    await context.close();
  }

  console.log(`PAGE_LOAD_PROFILE ${JSON.stringify(reports, null, 2)}`);
  const retainedReport = JSON.stringify({ baseline: measuredBaseline, after: reports }, null, 2);
  const retainedReportDirectory = path.join(process.cwd(), "test-results", "page-load-profile");
  await mkdir(retainedReportDirectory, { recursive: true });
  await writeFile(
    path.join(retainedReportDirectory, "before-after.json"),
    `${retainedReport}\n`,
    { mode: 0o600 },
  );
  await test.info().attach("page-load-profile-before-after.json", {
    body: Buffer.from(retainedReport),
    contentType: "application/json",
  });
});

test("records paint while projection hydration is held and reject stale completion", async ({ browser }) => {
  test.setTimeout(150_000);
  const storageState = await authenticatedStorageState(browser);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const page65 = fixture.pages.find((target) => target.id === 65);
  const page119 = fixture.pages.find((target) => target.id === 119);
  if (!page65 || !page119) throw new Error("Progressive-load fixture pages are unavailable");

  const blockedWrites: string[] = [];
  const recordQueries: Array<{
    pageId?: number;
    body: Record<string, unknown>;
  }> = [];
  let holdNextProjection = true;
  let releaseHeldProjection!: () => void;
  let projectionHeldResolve!: () => void;
  let projectionHeld = new Promise<void>((resolve) => {
    projectionHeldResolve = resolve;
  });

  const armProjectionHold = () => {
    holdNextProjection = true;
    projectionHeld = new Promise<void>((resolve) => {
      projectionHeldResolve = resolve;
    });
    releaseHeldProjection = () => {
      holdNextProjection = false;
      releaseHeldProjection = () => undefined;
      projectionHeldResolve();
    };
  };
  armProjectionHold();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/records/query")) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      recordQueries.push({
        pageId: typeof body.pageId === "number" ? body.pageId : undefined,
        body,
      });
    }
    if (holdNextProjection && isProjectionRequest(request.method(), request.url())) {
      holdNextProjection = false;
      projectionHeldResolve();
      await new Promise<void>((resolve) => {
        releaseHeldProjection = resolve;
      });
      await route.continue();
      return;
    }
    if (isReadOnlyApiRequest(request.method(), request.url())) {
      await route.continue();
      return;
    }
    blockedWrites.push(`${request.method()} ${normalizedApiPath(request.url())}`);
    await route.abort("blockedbyclient");
  });

  const rowSnapshot = () => page.locator("main table tbody tr").evaluateAll((rows) => rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? ""));
  const pendingProjectionCells = page.locator('[data-testid="record-projection-state"][data-state="pending"]');
  const recordsForPage = (pageId: number) => recordQueries.filter((request) => request.pageId === pageId);

  try {
    const initialRecordsResponse = page.waitForResponse((response) => response.url().endsWith("/records/query") && response.request().method() === "POST" && response.request().postDataJSON()?.pageId === page65.id && response.status() === 200);
    await page.goto(page65.path, { waitUntil: "domcontentloaded" });
    await initialRecordsResponse;
    await projectionHeld;

    // The authoritative rows must mount while one projection response is still
    // unresolved. This also proves the initial records query was not repeated
    // just to make the projection columns paint.
    await expect(page.locator("main table").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => page.locator("main table tbody tr").count()).toBeGreaterThan(0);
    await expect(pendingProjectionCells.first()).toBeVisible();
    expect(recordsForPage(page65.id)).toHaveLength(1);
    expect(blockedWrites).toEqual([]);

    releaseHeldProjection();
    await expect(pendingProjectionCells).toHaveCount(0, { timeout: 60_000 });
    const initialResolvedRows = await rowSnapshot();
    expect(initialResolvedRows.length).toBeGreaterThan(0);
    expect(recordsForPage(page65.id)).toHaveLength(1);

    // Hold a destination projection, navigate away before it resolves, then
    // release it after the next page is visible. The old completion must not
    // write into the destination table.
    armProjectionHold();
    const destinationRecordsResponse = page.waitForResponse((response) => response.url().endsWith("/records/query") && response.request().method() === "POST" && response.request().postDataJSON()?.pageId === page119.id && response.status() === 200);
    await page.locator(`a[href="${page119.path}"]`).first().click();
    await destinationRecordsResponse;
    await projectionHeld;
    await expect(page).toHaveURL(new RegExp(`${page119.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.locator("main table").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => page.locator("main table tbody tr").count()).toBeGreaterThan(0);

    // Do not hold the return navigation's projection request. Release the
    // held source-page response only after the destination has mounted.
    holdNextProjection = false;
    const returnRecordsResponse = page.waitForResponse((response) => response.url().endsWith("/records/query") && response.request().method() === "POST" && response.request().postDataJSON()?.pageId === page65.id && response.status() === 200);
    await page.locator(`a[href="${page65.path}"]`).first().click();
    await returnRecordsResponse;
    await expect(page).toHaveURL(new RegExp(`${page65.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.locator("main table").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(pendingProjectionCells).toHaveCount(0, { timeout: 60_000 });
    const returnRowsBeforeStaleRelease = await rowSnapshot();

    releaseHeldProjection();
    await page.waitForTimeout(500);
    expect(await rowSnapshot()).toEqual(returnRowsBeforeStaleRelease);
    expect(recordsForPage(page65.id)).toHaveLength(2);
    expect(recordsForPage(page119.id)).toHaveLength(1);
    expect(blockedWrites).toEqual([]);
  } finally {
    releaseHeldProjection?.();
    await context.close();
  }
});

test("same-entity mirror navigation rejects a late page-values response", async ({ browser }) => {
  test.setTimeout(120_000);
  const storageState = await authenticatedStorageState(browser);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const blockedWrites: string[] = [];
  let releaseOldRequest!: () => void;
  const oldRequestGate = new Promise<void>((resolve) => {
    releaseOldRequest = resolve;
  });
  let oldRequestSeen!: (recordIds: number[]) => void;
  const oldRequest = new Promise<number[]>((resolve) => {
    oldRequestSeen = resolve;
  });
  let heldOldRequest = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      !heldOldRequest &&
      request.method() === "POST" &&
      path === "/api/pages/119/record-values/query"
    ) {
      heldOldRequest = true;
      oldRequestSeen(request.postDataJSON()?.recordIds ?? []);
      await oldRequestGate;
      try {
        await route.continue();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Route is already handled")) throw error;
      }
      return;
    }
    if (isReadOnlyApiRequest(request.method(), request.url())) {
      await route.continue();
      return;
    }
    blockedWrites.push(`${request.method()} ${normalizedApiPath(request.url())}`);
    await route.abort("blockedbyclient");
  });

  try {
    await page.goto("/doh-one");
    const page119RecordIds = await oldRequest;
    await page.locator('a[href="/logistika"]').first().click();
    await expect(page).toHaveURL(/\/logistika$/);

    const page65ValuesResponse = await page.waitForResponse(
      (response) =>
        response.url().includes("/api/pages/65/record-values/query") &&
        response.request().method() === "POST" &&
        response.status() === 200,
    );
    const page65RecordIds = page65ValuesResponse.request().postDataJSON()?.recordIds ?? [];
    expect(page119RecordIds.some((id) => page65RecordIds.includes(id))).toBe(true);
    await expect(page.getByRole("heading", { name: "Логистика", exact: true })).toBeVisible();
    await expect(page.locator("main table").first()).toBeVisible();

    releaseOldRequest();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/logistika$/);
    await expect(page.getByRole("heading", { name: "Логистика", exact: true })).toBeVisible();
    expect(blockedWrites).toEqual([]);
  } finally {
    releaseOldRequest();
    await context.close();
  }
});

test("metadata bootstrap failure is explicit and retryable", async ({ browser }) => {
  test.setTimeout(120_000);
  const storageState = await authenticatedStorageState(browser);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  let allowMetadata = false;
  let recordQueries = 0;
  const failedMetadataPaths = new Set<string>();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "GET" &&
      (path === "/api/pages/65/views" || path === "/api/pages/65/fields") &&
      !allowMetadata
    ) {
      failedMetadataPaths.add(path);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Profiled metadata failure" }),
      });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/records/query")) recordQueries += 1;
    if (isReadOnlyApiRequest(request.method(), request.url())) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });

  try {
    await page.goto("/logistika");
    await expect(page.getByTestId("records-metadata-error")).toBeVisible({ timeout: 30_000 });
    expect([...failedMetadataPaths].sort()).toEqual([
      "/api/pages/65/fields",
      "/api/pages/65/views",
    ]);
    expect(recordQueries).toBe(0);
    allowMetadata = true;
    await page.getByRole("button", { name: /Повторить|Retry/ }).click();
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });
    expect(recordQueries).toBe(1);
  } finally {
    await context.close();
  }
});

test("an initial subscription gap gets one post-gap authoritative query", async ({ browser }) => {
  test.setTimeout(120_000);
  const storageState = await authenticatedStorageState(browser);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  let holdInitialStream = true;
  let releaseInitialStream!: () => void;
  const initialStreamGate = new Promise<void>((resolve) => {
    releaseInitialStream = resolve;
  });
  let recordQueries = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      holdInitialStream &&
      request.method() === "GET" &&
      path === "/api/collaboration/pages/65/stream"
    ) {
      holdInitialStream = false;
      await initialStreamGate;
      await route.abort("failed");
      return;
    }
    if (request.method() === "POST" && path.endsWith("/records/query")) recordQueries += 1;
    if (isReadOnlyApiRequest(request.method(), request.url())) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });

  try {
    await page.goto("/logistika");
    await expect.poll(() => recordQueries, { timeout: 60_000 }).toBe(1);
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });
    releaseInitialStream();
    await expect(page.getByTestId("collab-connection-status")).toHaveAttribute(
      "data-state",
      "connected",
      { timeout: 30_000 },
    );
    await expect.poll(() => recordQueries).toBe(2);
    await page.waitForTimeout(1_500);
    expect(recordQueries).toBe(2);
  } finally {
    releaseInitialStream();
    await context.close();
  }
});

test("stale page quick-filter keys do not hang successful empty page-field metadata", async ({ browser }) => {
  test.setTimeout(120_000);
  const storageState = await authenticatedStorageState(browser);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  let recordQueries = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/pages") {
      const response = await route.fetch();
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("Expected pages metadata array");
      await route.fulfill({
        response,
        json: body.map((item: Record<string, unknown>) =>
          item.id === 65
            ? {
                ...item,
                defaultQuickFilterJson: {
                  pageFieldFilters: { __deleted_page_field__: ["stale"] },
                },
              }
            : item,
        ),
      });
      return;
    }
    if (request.method() === "GET" && path === "/api/pages/65/fields") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/records/query")) recordQueries += 1;
    if (isReadOnlyApiRequest(request.method(), request.url())) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });

  try {
    await page.goto("/logistika");
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });
    expect(recordQueries).toBe(1);
    await expect(page.getByTestId("records-metadata-error")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("cached same-entity mirror navigation issues one destination-scoped query", async ({ browser }) => {
  test.setTimeout(150_000);
  const storageState = await authenticatedStorageState(browser);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const trackedDestinationQueries: Array<Record<string, unknown>> = [];
  let trackDestination = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      trackDestination &&
      request.method() === "POST" &&
      path.endsWith("/records/query")
    ) {
      trackedDestinationQueries.push(request.postDataJSON());
    }
    if (isReadOnlyApiRequest(request.method(), request.url())) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });

  try {
    const initialDestinationResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
      return response.request().postDataJSON()?.pageId === 65;
    });
    await page.goto("/logistika");
    const initialDestinationQuery =
      (await initialDestinationResponse).request().postDataJSON() as Record<string, unknown>;
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });

    const sourceResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
      return response.request().postDataJSON()?.pageId === 119;
    });
    await page.locator('a[href="/doh-one"]').first().click();
    await sourceResponse;
    await expect(page.getByRole("heading", { name: "Основной", exact: true })).toBeVisible();
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });

    trackDestination = true;
    const destinationResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith("/records/query") || response.request().method() !== "POST") return false;
      return response.request().postDataJSON()?.pageId === 65;
    });
    await page.locator('a[href="/logistika"]').first().click();
    await destinationResponse;
    await expect(page.getByRole("heading", { name: "Логистика", exact: true })).toBeVisible();
    await expect(page.locator("main table").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);

    expect(trackedDestinationQueries).toHaveLength(1);
    expect(trackedDestinationQueries[0]).toEqual(initialDestinationQuery);
  } finally {
    await context.close();
  }
});
