import { expect, test, type Page, type Route } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

/**
 * This test deliberately does not use the API server.  The page is backed by a
 * small in-memory fixture so a projection request can be paused without
 * touching the shared database (or relying on a live network response).
 */

const PAGE_ID = 42;
const ENTITY_ID = 7;
const RECORD_ID = 100;
const RELATED_RECORD_ID = 900;
const NEXT_RELATED_RECORD_ID = 901;
const PAGE_PATH = "/stable-background-refresh";
const MIRROR_PAGE_ID = 43;
const MIRROR_PAGE_PATH = "/stable-background-refresh-mirror";

const INITIAL_PROJECT = "Initial project with a deliberately long display value";
const REFRESHED_PROJECT = "Refreshed project with a deliberately long display value";
const INITIAL_PAGE_NOTE = "Initial page scalar retained during refresh";
const REFRESHED_PAGE_NOTE = "Refreshed page scalar published after refresh";
const INITIAL_TITLE = "Initial long record title used by the refresh regression";
const REFRESHED_TITLE = "Refreshed long record title used by the refresh regression";
const GROUP_LABEL = "Stable grouped bucket";

type ProjectionGate = {
  seen: Promise<void>;
  gate: Promise<void>;
  value: string;
  markSeen: () => void;
  release: () => void;
};

type MockApiOptions = {
  recordCount?: number;
  groupedMode?: boolean;
};

function userProfile() {
  return {
    id: 1,
    email: "stable-refresh@example.test",
    firstName: "Stable",
    lastName: "Refresh",
    roleId: 1,
    roleIds: [1],
    roleName: { en: "Stable refresh test" },
    language: "en",
    direction: "ltr",
    startPageId: PAGE_ID,
    isActive: true,
    permissions: {
      superAdmin: false,
      dashboard: false,
      pageIds: [PAGE_ID, MIRROR_PAGE_ID],
      admin: {
        pages: false,
        entities: false,
        roles: false,
        users: false,
        translations: false,
        events: false,
        modules: false,
        automations: false,
        customFilters: false,
        columnGroups: false,
        googleDrive: false,
        settings: false,
        dataImport: false,
        inboundIntegrations: false,
        documentGeneration: false,
        tags: false,
      },
      records: {
        [String(ENTITY_ID)]: {
          view: true,
          create: false,
          update: true,
          delete: false,
          scope: "all",
        },
      },
    },
  };
}

function pageMetadata() {
  return {
    id: PAGE_ID,
    nameJson: { en: "Stable background refresh" },
    descriptionJson: { en: "Mocked refresh regression fixture" },
    icon: "table",
    path: PAGE_PATH,
    parentPageId: null,
    mirrorEntityId: null,
    mirrorFieldKeysJson: null,
    mirrorFieldLabelsJson: null,
    mirrorColumnOrderJson: null,
    columnGroupsJson: null,
    mirrorPinnedJson: null,
    isDashboard: false,
    isPivot: false,
    sortOrder: 0,
    isActive: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function mirrorPageMetadata() {
  return {
    ...pageMetadata(),
    id: MIRROR_PAGE_ID,
    nameJson: { en: "Stable background refresh mirror" },
    path: MIRROR_PAGE_PATH,
    mirrorEntityId: ENTITY_ID,
  };
}

function entityMetadata() {
  return {
    id: ENTITY_ID,
    entityKey: "stable_refresh_fixture",
    nameJson: { en: "Stable refresh records" },
    descriptionJson: { en: "Mocked records" },
    icon: "table",
    pageId: PAGE_ID,
    defaultSortJson: [],
    defaultFilterJson: [],
    defaultPivotJson: null,
    defaultPageSize: 50,
    pivotEnabled: false,
    allowNoStatus: true,
    statusNameJson: { en: "Status" },
    statusSortOrder: null,
    statusManualEditPolicy: "allowed",
    statusManualEditUserIds: [],
    sortOrder: 0,
    isActive: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function entityFields(includeAmount = false) {
  const fields = [
    {
      id: 701,
      entityId: ENTITY_ID,
      fieldKey: "title",
      nameJson: { en: "Title" },
      fieldType: "text",
      isRequired: false,
      optionsJson: [],
      permissionsJson: { "1": "edit" },
      isFilterable: true,
      showInTable: true,
      isPinned: false,
      showColumnTotal: false,
      wrapText: false,
      sortOrder: 0,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: 702,
      entityId: ENTITY_ID,
      fieldKey: "stage",
      nameJson: { en: "Stage" },
      fieldType: "select",
      isRequired: false,
      optionsJson: [
        { value: "todo", labelJson: { en: "To do" } },
        { value: "done", labelJson: { en: "Done" } },
      ],
      permissionsJson: { "1": "edit" },
      isFilterable: true,
      showInTable: true,
      isPinned: false,
      showColumnTotal: false,
      wrapText: false,
      sortOrder: 1,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
  if (includeAmount) {
    fields.push({
      id: 703,
      entityId: ENTITY_ID,
      fieldKey: "amount",
      nameJson: { en: "Amount" },
      fieldType: "number",
      isRequired: false,
      optionsJson: [],
      permissionsJson: { "1": "edit" },
      isFilterable: true,
      showInTable: true,
      isPinned: false,
      showColumnTotal: true,
      wrapText: false,
      sortOrder: 2,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    fields.push({
      id: 704,
      entityId: ENTITY_ID,
      fieldKey: "category",
      nameJson: { en: "Category" },
      fieldType: "text",
      isRequired: false,
      optionsJson: [],
      permissionsJson: { "1": "edit" },
      isFilterable: true,
      showInTable: false,
      isPinned: false,
      showColumnTotal: false,
      wrapText: false,
      sortOrder: 3,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
  }
  return fields;
}

function pageFields() {
  return [
    {
      id: 4201,
      pageId: PAGE_ID,
      fieldKey: "project_name",
      nameJson: { en: "Project" },
      fieldType: "relation",
      isRequired: false,
      isFilterable: false,
      optionsJson: [],
      relationConfigJson: {
        relationId: 1,
        relatedFieldKey: "name",
      },
       permissionsJson: { "1": "edit" },
      showInTable: true,
      isPinned: false,
      showColumnTotal: false,
      wrapText: false,
      sortOrder: 2,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: 4202,
      pageId: PAGE_ID,
      fieldKey: "project_formula",
      nameJson: { en: "Project formula" },
      fieldType: "function",
      isRequired: false,
      isFilterable: false,
      optionsJson: [],
      formulaConfigJson: { expression: "{project_name}" },
      permissionsJson: { "1": "view" },
      showInTable: true,
      isPinned: false,
      showColumnTotal: false,
      wrapText: false,
      sortOrder: 3,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: 4203,
      pageId: PAGE_ID,
      fieldKey: "page_note",
      nameJson: { en: "Page note" },
      fieldType: "text",
      isRequired: false,
      isFilterable: false,
      optionsJson: [],
      permissionsJson: { "1": "edit" },
      showInTable: true,
      isPinned: false,
      showColumnTotal: false,
      wrapText: false,
      sortOrder: 4,
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
}

function record(
  revision: number,
  id = RECORD_ID,
  stageOverride?: string,
  versionOverride?: number,
) {
  return {
    id,
    entityId: ENTITY_ID,
    valuesJson: {
      title:
        id === RECORD_ID
          ? revision === 0
            ? INITIAL_TITLE
            : REFRESHED_TITLE
          : `${revision === 0 ? INITIAL_TITLE : REFRESHED_TITLE} #${id}`,
      stage: stageOverride ?? (revision === 0 ? "todo" : "done"),
    },
    statusId: null,
    archivedAt: null,
    statusChangedAt: null,
    version: versionOverride ?? revision + 1,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

async function installMockApi(page: Page, options: MockApiOptions = {}) {
  const recordCount = options.recordCount ?? 1;
  const groupedMode = options.groupedMode ?? false;
  await page.addInitScript(() => {
    localStorage.setItem("erp_token", "fake-stable-refresh-token");
  });

  let recordsQueryCount = 0;
  let recordsRevision = 0;
  let entityStage: string | null = null;
  let pageNoteValue: string | null = null;
  let latestRecordVersion = 1;
  let latestPageValueVersion = 1;
  let failNextRecordsQuery = false;
  let failRecordsQueryCount = 0;
  let failNextProjectionRequest = false;
  let failNextRecordUpdate = false;
  let failNextPageValueUpdate = false;
  let projection: ProjectionGate | null = null;
  let pageValuesProjection: ProjectionGate | null = null;
  let recordUpdate: ProjectionGate | null = null;
  let pageValueUpdate: ProjectionGate | null = null;
  let recordsQuery: ProjectionGate | null = null;
  const recordsQueryRequests: Array<Record<string, unknown>> = [];
  const projectionRequests: Array<Record<string, unknown>> = [];
  const pageValuesRequests: Array<Record<string, unknown>> = [];
  const recordUpdateRequests: Array<Record<string, unknown>> = [];
  const pageValueUpdateRequests: Array<Record<string, unknown>> = [];
  const relatedLinkRequests: Array<Record<string, unknown>> = [];
  const unknownApiRequests: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "GET" && path === "/api/auth/me") return json(route, userProfile());
    if (method === "GET" && path === "/api/pages") {
      return json(route, [
        pageMetadata(),
        {
          ...mirrorPageMetadata(),
          ...(groupedMode
            ? { groupByFieldKey: "category", groupDefaultExpanded: false }
            : {}),
        },
      ]);
    }
    if (method === "GET" && path === "/api/entities") return json(route, [entityMetadata()]);
    if (method === "GET" && path === `/api/entities/${ENTITY_ID}`) return json(route, entityMetadata());
    if (method === "GET" && path === `/api/entities/${ENTITY_ID}/fields`) {
      return json(route, entityFields(groupedMode));
    }
    if (method === "GET" && path === `/api/pages/${PAGE_ID}/fields`) {
      return json(route, pageFields());
    }
    if (method === "GET" && path === `/api/pages/${MIRROR_PAGE_ID}/fields`) {
      return json(
        route,
        groupedMode
          ? pageFields()
              .filter((field) => field.fieldKey === "project_name")
              .map((field) => ({ ...field, pageId: MIRROR_PAGE_ID }))
          : [],
      );
    }
    if (
      method === "GET" &&
      (path === `/api/entities/${ENTITY_ID}/main-views` ||
        (path.startsWith("/api/pages/") && path.endsWith("/views")))
    ) {
      return json(route, []);
    }
    if (method === "GET" && path === `/api/entities/${ENTITY_ID}/statuses`) return json(route, []);
    if (method === "GET" && path === `/api/entities/${ENTITY_ID}/transitions`) {
      return json(route, []);
    }
    if (method === "GET" && path === `/api/entities/${ENTITY_ID}/relations`) return json(route, []);
    if (method === "GET" && path === `/api/entities/${ENTITY_ID}/custom-filters`) {
      return json(route, []);
    }
    if (method === "GET" && path === "/api/column-groups") return json(route, []);
    if (method === "GET" && path === "/api/users/options") return json(route, []);
    if (method === "GET" && path === "/api/roles") return json(route, []);
    if (method === "GET" && path === "/api/translations") return json(route, []);
    if (method === "GET" && path === "/api/settings") {
      return json(route, {
        appNameJson: { en: "ERP" },
        subtitleJson: { en: "" },
        logoObjectPath: null,
        currencySymbol: "$",
        defaultLanguage: "en",
        timeZone: "UTC",
        workingDays: [1, 2, 3, 4, 5],
        firstDayOfWeek: 1,
        tableStyle: "plain",
        tableStripeColor: null,
        tableHeaderColor: null,
        tableBorderColor: null,
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
    }
    if (method === "GET" && path.startsWith("/api/pages/") && path.endsWith("/dashboard/data")) {
      return json(route, []);
    }
    if (
      method === "GET" &&
      path.startsWith("/api/collaboration/pages/") &&
      path.endsWith("/stream")
    ) {
      // A 404 keeps this test deterministic and makes the records query
      // independent of SSE reconnect timing.
      return json(route, { error: "collaboration disabled in mock" }, 404);
    }
    if (
      method === "PUT" &&
      path.startsWith("/api/collaboration/pages/") &&
      path.endsWith("/presence")
    ) {
      return json(route, { success: true });
    }

    if (method === "POST" && path === `/api/entities/${ENTITY_ID}/records/query`) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      recordsQueryRequests.push(body);
      if (failNextRecordsQuery || failRecordsQueryCount > 0) {
        failNextRecordsQuery = false;
        if (failRecordsQueryCount > 0) failRecordsQueryCount -= 1;
        return json(route, { error: "mocked background refetch failed" }, 500);
      }
      const revision = recordsRevision;
      recordsQueryCount += 1;
      const currentRecord = record(revision);
      latestRecordVersion = Math.max(latestRecordVersion, currentRecord.version);
      const rows = Array.from({ length: recordCount }, (_, index) => {
        const id = RECORD_ID + index;
        const row = record(
          revision,
          id,
          id === RECORD_ID ? entityStage ?? undefined : undefined,
          id === RECORD_ID ? latestRecordVersion : undefined,
        );
        if (groupedMode) {
          row.valuesJson.amount = revision === 0 ? 123 : 0;
          row.valuesJson.category = GROUP_LABEL;
        }
        return row;
      });
      const currentRecordsQuery = recordsQuery;
      if (currentRecordsQuery) {
        recordsQuery = null;
        currentRecordsQuery.markSeen();
        await currentRecordsQuery.gate;
      }
      return json(route, {
        data: rows,
        total: rows.length,
        numericTotals: groupedMode ? { amount: revision === 0 ? 123 : 0 } : {},
        ...(groupedMode && body.grouped === true
          ? {
              groups: [
                {
                  key: GROUP_LABEL,
                  label: GROUP_LABEL,
                  count: rows.length,
                  sums: { amount: revision === 0 ? 123 : 0 },
                  values: { stage: entityStage ?? (revision === 0 ? "todo" : "done") },
                },
              ],
              ...(body.withRowGroups === true
                ? {
                    rowGroups: Object.fromEntries(
                      rows.map((row) => [
                        String(row.id),
                        GROUP_LABEL,
                      ]),
                    ),
                  }
                : {}),
            }
          : {}),
        pageFormulaValues: Object.fromEntries(
          rows.map((row) => [
            String(row.id),
            { project_formula: revision === 0 ? INITIAL_PROJECT : REFRESHED_PROJECT },
          ]),
        ),
      });
    }
    if (method === "PUT" && path === `/api/records/${RECORD_ID}`) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      recordUpdateRequests.push(body);
      if (failNextRecordUpdate) {
        failNextRecordUpdate = false;
        return json(route, { error: "mocked entity save failed" }, 503);
      }
      const valuesJson = (body.valuesJson ?? {}) as Record<string, unknown>;
      if (typeof valuesJson.stage === "string") entityStage = valuesJson.stage;
      latestRecordVersion += 1;
      const currentUpdate = recordUpdate;
      if (currentUpdate) {
        recordUpdate = null;
        currentUpdate.markSeen();
        await currentUpdate.gate;
      }
      return json(
        route,
        record(recordsRevision, RECORD_ID, entityStage ?? undefined, latestRecordVersion),
      );
    }
    if (method === "PUT" && path === `/api/pages/${PAGE_ID}/records/${RECORD_ID}/values`) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      pageValueUpdateRequests.push(body);
      if (failNextPageValueUpdate) {
        failNextPageValueUpdate = false;
        return json(route, { error: "mocked page scalar save failed" }, 503);
      }
      const valuesJson = (body.valuesJson ?? {}) as Record<string, unknown>;
      if (typeof valuesJson.page_note === "string") pageNoteValue = valuesJson.page_note;
      latestPageValueVersion += 1;
      const currentPageValueUpdate = pageValueUpdate;
      if (currentPageValueUpdate) {
        pageValueUpdate = null;
        currentPageValueUpdate.markSeen();
        await currentPageValueUpdate.gate;
      }
      return json(route, {
        recordId: RECORD_ID,
        valuesJson: { page_note: pageNoteValue ?? INITIAL_PAGE_NOTE },
        version: latestPageValueVersion,
        fieldVersions: { page_note: latestPageValueVersion },
      });
    }
    if (method === "POST" && path.startsWith("/api/pages/") && path.endsWith("/record-values/query")) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      pageValuesRequests.push(body);
      const currentPageValues = path === `/api/pages/${PAGE_ID}/record-values/query`
        ? pageValuesProjection
        : null;
      if (currentPageValues) {
        currentPageValues.markSeen();
        await currentPageValues.gate;
      }
      return json(route, path === `/api/pages/${PAGE_ID}/record-values/query` ? [{
        recordId: RECORD_ID,
        valuesJson: {
          page_note:
            currentPageValues?.value ??
            pageNoteValue ??
            (recordsRevision === 0 ? INITIAL_PAGE_NOTE : REFRESHED_PAGE_NOTE),
        },
        version: pageNoteValue == null ? (recordsRevision === 0 ? 1 : 2) : latestPageValueVersion,
        fieldVersions: {
          page_note: pageNoteValue == null ? (recordsRevision === 0 ? 1 : 2) : latestPageValueVersion,
        },
      }] : []);
    }
    if (
      method === "POST" &&
      (path === `/api/pages/${PAGE_ID}/related-values` ||
        (groupedMode && path === `/api/pages/${MIRROR_PAGE_ID}/related-values`))
    ) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      projectionRequests.push(body);
      if (failNextProjectionRequest) {
        failNextProjectionRequest = false;
        return json(route, { error: "mocked projection failed" }, 503);
      }
      const currentProjection = projection;
      if (currentProjection) {
        // Resolve only when the request is actually paused. The caller can
        // now assert that stale values are still visible.
        currentProjection.markSeen();
        await currentProjection.gate;
      }
      return json(route, {
        columns: [
          {
            fieldKey: "project_name",
            relatedFieldKey: "name",
            relatedFieldType: "text",
            optionsJson: [],
            editableColumn: true,
          },
        ],
        values: [
          {
            recordId: RECORD_ID,
            fieldKey: "project_name",
            value:
              currentProjection?.value ??
              (projectionRequests.length === 1 ? INITIAL_PROJECT : REFRESHED_PROJECT),
            linkedRecordId: RELATED_RECORD_ID,
            editable: true,
          },
        ],
      });
    }
    if (method === "POST" && path === `/api/pages/${PAGE_ID}/related-candidates`) {
      return json(route, {
        candidates: [
          { id: NEXT_RELATED_RECORD_ID, label: "Next project candidate with a long label" },
        ],
      });
    }
    if (method === "PUT" && path === `/api/pages/${PAGE_ID}/related-link`) {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      relatedLinkRequests.push(body);
      return json(route, {
        linkedRecordId: body.linkedRecordId ?? null,
        value: "Next project candidate with a long label",
        version: 2,
      });
    }
    if (method === "POST" && path === `/api/entities/${ENTITY_ID}/filter-values`) {
      return json(route, { values: [] });
    }
    if (method === "POST" && path === `/api/pages/${PAGE_ID}/filter-values`) {
      return json(route, { values: [] });
    }

    // Every API request is fulfilled here. A test run must never fall through
    // to the live database.
    unknownApiRequests.push(`${method} ${path}`);
    return json(route, { error: `Unhandled mocked endpoint: ${method} ${path}` }, 404);
  });

  return {
    armProjectionHold() {
      let markSeen!: () => void;
      let releaseRequest!: () => void;
      const seen = new Promise<void>((resolve) => {
        markSeen = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      projection = {
        seen,
        gate: released,
        value: projectionRequests.length === 0 ? INITIAL_PROJECT : REFRESHED_PROJECT,
        markSeen,
        release: () => {
          if (projection?.gate === released) projection = null;
          releaseRequest();
        },
      };
      return { seen, release: projection.release, markSeen };
    },
    armPageValuesHold() {
      let markSeen!: () => void;
      let releaseRequest!: () => void;
      const seen = new Promise<void>((resolve) => {
        markSeen = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      pageValuesProjection = {
        seen,
        gate: released,
        value: REFRESHED_PAGE_NOTE,
        markSeen,
        release: () => {
          if (pageValuesProjection?.gate === released) pageValuesProjection = null;
          releaseRequest();
        },
      };
      return { seen, release: pageValuesProjection.release, markSeen };
    },
    armUpdateHold() {
      let markSeen!: () => void;
      let releaseRequest!: () => void;
      const seen = new Promise<void>((resolve) => {
        markSeen = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      recordUpdate = {
        seen,
        gate: released,
        value: "",
        markSeen,
        release: releaseRequest,
      };
      return { seen, release: releaseRequest, markSeen };
    },
    armPageValueUpdateHold() {
      let markSeen!: () => void;
      let releaseRequest!: () => void;
      const seen = new Promise<void>((resolve) => {
        markSeen = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      pageValueUpdate = {
        seen,
        gate: released,
        value: "",
        markSeen,
        release: releaseRequest,
      };
      return { seen, release: releaseRequest, markSeen };
    },
    armRecordsQueryHold() {
      let markSeen!: () => void;
      let releaseRequest!: () => void;
      const seen = new Promise<void>((resolve) => {
        markSeen = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      recordsQuery = {
        seen,
        gate: released,
        value: "",
        markSeen,
        release: releaseRequest,
      };
      return { seen, release: releaseRequest, markSeen };
    },
    failNextRecordsQuery() {
      // Disconnect-mode automation can schedule two refreshes around the
      // explicit manual refresh. Keep the one-shot failure armed through that
      // small burst so a scheduled request cannot consume the test's fault.
      failRecordsQueryCount = 3;
    },
    failNextProjection() {
      failNextProjectionRequest = true;
    },
    failNextRecordUpdate() {
      failNextRecordUpdate = true;
    },
    failNextPageValueUpdate() {
      failNextPageValueUpdate = true;
    },
    markRecordsRefreshed() {
      recordsRevision = 1;
    },
    projectionRequests,
    pageValuesRequests,
    recordUpdateRequests,
    pageValueUpdateRequests,
    relatedLinkRequests,
    recordsQueryRequests,
    currentRecordVersion: () => latestRecordVersion,
    currentPageValueVersion: () => latestPageValueVersion,
    unknownApiRequests,
  };
}

test.use({ viewport: { width: 1440, height: 900 } });

test("keeps stale projections rendered during a delayed background refresh", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page);

  const initialProjection = mock.armProjectionHold();
  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();

  // The records query paints the row before the related-values projection
  // completes.  Initial hydration is allowed to show an explicit pending
  // state; the regression is about preserving a ready snapshot on refresh.
  await initialProjection.seen;
  await expect(page.getByTestId("record-projection-state").first()).toBeVisible();
  initialProjection.release();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(INITIAL_PAGE_NOTE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("record-projection-state")).toHaveCount(0);

  const tableRow = page.locator("main table tbody tr").first();
  const formulaCell = tableRow.locator("td").nth(3);
  const pageNoteCell = tableRow.locator("td").nth(4);
  await expect(formulaCell).toContainText(INITIAL_PROJECT);
  await expect(pageNoteCell).toContainText(INITIAL_PAGE_NOTE);
  const relationCell = page
    .locator("main table tbody tr").first()
    .locator("td")
    .filter({ hasText: INITIAL_PROJECT })
    .first();
  await expect(relationCell).toBeVisible();
  const beforeRefresh = await relationCell.boundingBox();
  expect(beforeRefresh).not.toBeNull();

  const relatedBeforeManual = mock.projectionRequests.length;
  const pageValuesBeforeManual = mock.pageValuesRequests.length;
  mock.markRecordsRefreshed();
  const pageValuesRefresh = mock.armPageValuesHold();
  const refreshProjection = mock.armProjectionHold();
  await page.getByTestId("button-refresh-data-desktop").click();
  await Promise.all([refreshProjection.seen, pageValuesRefresh.seen]);

  // The row and all of its dependent projections stay on one coherent stale
  // snapshot until the delayed projection completes; no mixed-generation title
  // is published alongside the old relation/formula values. The previous long
  // value and its measured column geometry remain usable instead of being
  // replaced by a per-cell loading placeholder.
  await expect(page.getByText(INITIAL_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByText(REFRESHED_TITLE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();
  await expect(formulaCell).toContainText(INITIAL_PROJECT);
  await expect(pageNoteCell).toContainText(INITIAL_PAGE_NOTE);
  await expect(page.getByTestId("record-projection-state")).toHaveCount(0);
  const duringRefresh = await relationCell.boundingBox();
  expect(duringRefresh).not.toBeNull();
  expect(Math.abs(duringRefresh!.x - beforeRefresh!.x)).toBeLessThan(0.5);
  expect(Math.abs(duringRefresh!.width - beforeRefresh!.width)).toBeLessThan(0.5);

  refreshProjection.release();
  pageValuesRefresh.release();
  await expect(page.getByText(REFRESHED_PROJECT, { exact: true }).first()).toBeVisible();
  await expect(formulaCell).toContainText(REFRESHED_PROJECT);
  await expect(page.getByText(REFRESHED_PAGE_NOTE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("record-projection-state")).toHaveCount(0);
  expect(mock.projectionRequests.length).toBe(relatedBeforeManual + 1);
  expect(mock.pageValuesRequests.length).toBe(pageValuesBeforeManual + 1);
  expect(mock.unknownApiRequests).toEqual([]);
});


test("keeps inline editors stable across rapid select reopen and refresh failure", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page);

  const initialProjection = mock.armProjectionHold();
  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();
  await initialProjection.seen;
  initialProjection.release();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();

  // A picker that closes and reopens immediately must still be usable, rather
  // than leaving the cell in a half-closed editing state.
  const stageValue = page.getByText("To do", { exact: true }).first();
  await stageValue.click();
  await expect(page.getByRole("option", { name: "Done", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await stageValue.click();
  await expect(page.getByRole("option", { name: "Done", exact: true })).toBeVisible();
  mock.markRecordsRefreshed();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();

  // Keep a real text draft open while the row refreshes and its projection is
  // deliberately delayed. The draft is local editor state and must not reset
  // to the refreshed server value.
  const draftTitle = "Unsaved title draft survives a background refresh";
  const refreshedTitle = page.getByText(REFRESHED_TITLE, { exact: true }).first();
  await refreshedTitle.click();
  const titleEditor = page.getByTestId("cell-editor-input");
  await expect(titleEditor).toBeVisible();
  await titleEditor.fill(draftTitle);

  // Clicking the global refresh naturally blurs a text editor. Hold that
  // mutation so the editor remains mounted while the independent background
  // projection refresh is in flight.
  const updateHold = mock.armUpdateHold();
  const refreshProjection = mock.armProjectionHold();
  await page.getByTestId("button-refresh-data-desktop").click();
  await Promise.all([updateHold.seen, refreshProjection.seen]);
  await expect(titleEditor).toHaveValue(draftTitle);
  await expect(page.getByTestId("inline-saving")).toBeVisible();
  refreshProjection.release();
  await expect(titleEditor).toHaveValue(draftTitle);
  updateHold.release();
  await expect(titleEditor).toHaveCount(0);

  // A failed background refetch reports an error but does not erase the stale
  // row snapshot.
  // The status save schedules disconnect-mode automation refreshes at 400ms and
  // 1200ms; let those planned refreshes settle before arming this deliberate
  // one-shot failure so it cannot be consumed by the scheduled work.
  await page.waitForTimeout(3_000);
  mock.failNextRecordsQuery();
  await page.getByTestId("button-refresh-data-desktop").click();
  await expect(page.getByText("Ошибка загрузки записей", { exact: true })).toBeVisible();
  await expect(page.getByText(REFRESHED_TITLE, { exact: true }).first()).toBeVisible();
  expect(mock.unknownApiRequests).toEqual([]);
});

test(
  "opens a select during a held projection and publishes entity/page saves inline",
  async ({ page }) => {
    test.setTimeout(90_000);
    const mock = await installMockApi(page, { recordCount: 200 });

    const initialProjection = mock.armProjectionHold();
    await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main table").first()).toBeVisible();
    await initialProjection.seen;
    initialProjection.release();
    await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();

    // First open and ACK a page-local scalar while its own ready snapshot is
    // present. A subsequent held read is the pre-save snapshot that must not
    // revert the already acknowledged value.
    const latestPageNote = "Page scalar saved while projection remains pending";
    await page.getByText(INITIAL_PAGE_NOTE, { exact: true }).click();
    const pageNoteEditor = page.getByTestId("cell-editor-input");
    await expect(pageNoteEditor).toBeVisible();
    await pageNoteEditor.fill(latestPageNote);
    await pageNoteEditor.press("Enter");
    await expect.poll(() => mock.pageValueUpdateRequests.length).toBe(1);
    await expect(page.getByText(latestPageNote, { exact: true })).toBeVisible();
    expect(mock.pageValueUpdateRequests[0]).toMatchObject({
      expectedVersions: { [String(PAGE_ID)]: 1 },
      valuesJson: { page_note: latestPageNote },
    });

    const stalePageRead = mock.armPageValuesHold();
    const pageProjection = mock.armProjectionHold();
    await page.getByTestId("button-refresh-data-desktop").click();
    await Promise.all([stalePageRead.seen, pageProjection.seen]);
    stalePageRead.release();
    pageProjection.release();
    await expect(page.getByText(latestPageNote, { exact: true })).toBeVisible();
    expect(mock.pageValueUpdateRequests.length).toBe(1);
    await expect(page.getByTestId("inline-saving")).toHaveCount(0);

    // A background refresh leaves the unrelated projection request pending.
    // Opening the select must not wait for that request or for all 200 mocked
    // rows to finish hydrating.
    const projectionBeforeRefresh = mock.projectionRequests.length;
    const heldProjection = mock.armProjectionHold();
    await page.getByTestId("button-refresh-data-desktop").click();
    await heldProjection.seen;
    const stage = page.getByText("To do", { exact: true }).first();
    await expect(stage).toBeVisible();
    await stage.click();
    await expect(page.getByRole("option", { name: "Done", exact: true })).toBeVisible();
    expect(mock.projectionRequests.length).toBeGreaterThan(projectionBeforeRefresh);

    const initialVersion = mock.currentRecordVersion();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();
    await expect.poll(() => mock.recordUpdateRequests.length).toBe(1);
    expect(mock.recordUpdateRequests[0]).toMatchObject({
      expectedVersion: initialVersion,
      valuesJson: { stage: "done" },
    });
    expect(mock.currentRecordVersion()).toBe(initialVersion + 1);

    // Reopening immediately reads the committed scalar, not the pre-save
    // editor draft or a stale projection snapshot, without releasing the
    // unrelated background projection first.
    const savedStageCell = page.getByRole("cell", { name: "Done", exact: true }).first();
    await expect(savedStageCell).toBeVisible();
    await savedStageCell.click();
    await expect(page.getByRole("option", { name: "Done", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    heldProjection.release();

    expect(mock.unknownApiRequests).toEqual([]);
  },
);

test(
  "profile: measures select reopen while a projection is held",
  async ({ page, context }) => {
    test.skip(
      process.env.RUN_INLINE_EDITOR_PROFILE !== "1",
      "Opt-in CDP performance profile",
    );
    test.setTimeout(90_000);

    const startedAt = Date.now();
    const diagnosticDirectory = "test-results/inline-editor-profile";
    const checkpointPath = `${diagnosticDirectory}/checkpoints.jsonl`;
    mkdirSync(diagnosticDirectory, { recursive: true });
    writeFileSync(checkpointPath, "");
    const pageConsole: Array<{ type: string; text: string }> = [];
    const pageErrors: string[] = [];
    const network = new Map<string, number>();
    page.on("console", (message) => {
      pageConsole.push({ type: message.type(), text: message.text() });
    });
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return;
      const key = `${request.method()} ${url.pathname}`;
      network.set(key, (network.get(key) ?? 0) + 1);
    });
    const checkpoint = (name: string, extra: unknown = {}) => {
      const value = {
        name,
        elapsedMs: Date.now() - startedAt,
        ...((extra as Record<string, unknown>) ?? {}),
      };
      appendFileSync(checkpointPath, `${JSON.stringify(value)}\n`);
      console.log(`INLINE_EDITOR_PROFILE_CHECKPOINT ${JSON.stringify(value)}`);
    };

    const mock = await installMockApi(page, { recordCount: 200 });
    const initialProjection = mock.armProjectionHold();
    await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main table").first()).toBeVisible();
    await initialProjection.seen;
    initialProjection.release();
    await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();

    const latestPageNote = "Page scalar saved while projection remains pending";
    await page.getByText(INITIAL_PAGE_NOTE, { exact: true }).click();
    const pageNoteEditor = page.getByTestId("cell-editor-input");
    await expect(pageNoteEditor).toBeVisible();
    await pageNoteEditor.fill(latestPageNote);
    await pageNoteEditor.press("Enter");
    await expect.poll(() => mock.pageValueUpdateRequests.length).toBe(1);
    await expect(page.getByText(latestPageNote, { exact: true })).toBeVisible();

    const stalePageRead = mock.armPageValuesHold();
    const pageProjection = mock.armProjectionHold();
    await page.getByTestId("button-refresh-data-desktop").click();
    await Promise.all([stalePageRead.seen, pageProjection.seen]);
    stalePageRead.release();
    pageProjection.release();
    await expect(page.getByText(latestPageNote, { exact: true })).toBeVisible();
    await expect(page.getByTestId("inline-saving")).toHaveCount(0);

    const heldProjection = mock.armProjectionHold();
    await page.getByTestId("button-refresh-data-desktop").click();
    await heldProjection.seen;
    const firstStageOpenStartedAt = Date.now();
    await page.getByText("To do", { exact: true }).first().click({ timeout: 10_000 });
    await expect(page.getByRole("option", { name: "Done", exact: true })).toBeVisible();
    checkpoint("first-stage-option-visible", {
      clickToOptionMs: Date.now() - firstStageOpenStartedAt,
    });
    const initialVersion = mock.currentRecordVersion();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();
    await expect.poll(() => mock.recordUpdateRequests.length).toBe(1);
    checkpoint("entity-save-ack", {
      initialVersion,
      currentVersion: mock.currentRecordVersion(),
      recordUpdates: mock.recordUpdateRequests.length,
      projectionRequests: mock.projectionRequests.length,
    });

    const savedStageCell = page.getByRole("cell", { name: "Done", exact: true }).first();
    await expect(savedStageCell).toBeVisible();
    const domBefore = await page.evaluate(() => {
      const tables = [...document.querySelectorAll("main table")];
      const rows = [...document.querySelectorAll("main table tbody tr")];
      const cells = [...document.querySelectorAll("main table tbody td")];
      const exactDoneCells = cells.filter((cell) => cell.textContent?.trim() === "Done");
      const describe = (element: Element) => {
        const html = element as HTMLElement;
        const style = getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return {
          tag: html.tagName,
          role: html.getAttribute("role"),
          text: html.textContent?.trim(),
          connected: html.isConnected,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          opacity: style.opacity,
          ariaDisabled: html.getAttribute("aria-disabled"),
          disabled: "disabled" in html ? Boolean((html as HTMLButtonElement).disabled) : null,
          topAtCenter:
            document.elementFromPoint(centerX, centerY)?.outerHTML.slice(0, 300) ?? null,
        };
      };
      return {
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        tableCount: tables.length,
        rowCount: rows.length,
        cellCount: cells.length,
        exactDoneCellCount: exactDoneCells.length,
        exactDoneCells: exactDoneCells.map(describe),
        optionCount: document.querySelectorAll('[role="option"]').length,
        projectionStateCount: document.querySelectorAll(
          '[data-testid="record-projection-state"]',
        ).length,
        inlineSavingCount: document.querySelectorAll('[data-testid="inline-saving"]').length,
        activeElement: document.activeElement?.outerHTML.slice(0, 500) ?? null,
      };
    });
    checkpoint("before-problem-click-dom", domBefore);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
    const profileStartedAt = Date.now();
    const stopProfile = new Promise<{
      profile?: {
        nodes: Array<{
          id: number;
          callFrame: {
            functionName: string;
            url: string;
            lineNumber: number;
            columnNumber: number;
          };
        }>;
        samples?: number[];
        timeDeltas?: number[];
      };
      error?: string;
    }>((resolve) => {
      setTimeout(() => {
        cdp
          .send("Profiler.stop")
          .then((result) => {
            writeFileSync(
              `${diagnosticDirectory}/cpu-profile-timer.json`,
              JSON.stringify(result.profile),
            );
            checkpoint("independent-timer-profile-stopped", {
              nodes: result.profile.nodes.length,
              samples: result.profile.samples?.length ?? 0,
            });
            resolve(result);
          })
          .catch((error: Error) => {
            checkpoint("independent-timer-profile-error", {
              error: error.stack ?? error.message,
            });
            resolve({ error: error.stack ?? error.message });
          });
      }, 10_000);
    });

    const clickStartedAt = Date.now();
    const clickResult = await savedStageCell
      .click({ timeout: 10_000 })
      .then(() => ({ outcome: "resolved", elapsedMs: Date.now() - clickStartedAt }))
      .catch((error: Error) => ({
        outcome: "rejected",
        elapsedMs: Date.now() - clickStartedAt,
        error: error.message,
      }));
    const reopenOptionStartedAt = Date.now();
    const reopenOptionPromise = page
      .getByRole("option", { name: "Done", exact: true })
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => ({
        outcome: "visible",
        elapsedFromClickStartMs: Date.now() - clickStartedAt,
        elapsedAfterClickResolvedMs: Date.now() - reopenOptionStartedAt,
      }))
      .catch((error: Error) => ({
        outcome: "not-visible",
        elapsedFromClickStartMs: Date.now() - clickStartedAt,
        elapsedAfterClickResolvedMs: Date.now() - reopenOptionStartedAt,
        error: error.message,
      }));
    const [stopped, reopenOptionResult] = await Promise.all([stopProfile, reopenOptionPromise]);
    const profile = stopped.profile;
    const nodeById = new Map(profile?.nodes.map((node) => [node.id, node]));
    const totals = new Map<number, { samples: number; micros: number }>();
    for (let index = 0; index < (profile?.samples?.length ?? 0); index += 1) {
      const nodeId = profile!.samples![index];
      const current = totals.get(nodeId) ?? { samples: 0, micros: 0 };
      current.samples += 1;
      current.micros += profile!.timeDeltas?.[index] ?? 0;
      totals.set(nodeId, current);
    }
    const sampledMicros = [...totals.values()].reduce((sum, value) => sum + value.micros, 0);
    const hotFrames = [...totals.entries()]
      .map(([nodeId, value]) => {
        const frame = nodeById.get(nodeId)?.callFrame;
        return {
          nodeId,
          samples: value.samples,
          sampledMs: Math.round(value.micros / 100) / 10,
          sampledPercent:
            sampledMicros === 0 ? 0 : Math.round((value.micros / sampledMicros) * 10_000) / 100,
          functionName: frame?.functionName ?? "",
          url: frame?.url ?? "",
          line: (frame?.lineNumber ?? -1) + 1,
          column: (frame?.columnNumber ?? -1) + 1,
        };
      })
      .sort((a, b) => b.sampledMs - a.sampledMs)
      .slice(0, 30);

    if (profile) {
      writeFileSync(
        `${diagnosticDirectory}/cpu-profile.json`,
        JSON.stringify(profile),
      );
    }
    const diagnostic = {
      clickResult,
      reopenOptionResult,
      profileWallMs: Date.now() - profileStartedAt,
      profilerError: stopped.error ?? null,
      profileNodeCount: profile?.nodes.length ?? 0,
      profileSampleCount: profile?.samples?.length ?? 0,
      sampledMs: Math.round(sampledMicros / 100) / 10,
      hotFrames,
      domBefore,
      network: Object.fromEntries([...network.entries()].sort()),
      mockCounts: {
        projectionRequests: mock.projectionRequests.length,
        pageValuesRequests: mock.pageValuesRequests.length,
        recordUpdateRequests: mock.recordUpdateRequests.length,
        pageValueUpdateRequests: mock.pageValueUpdateRequests.length,
        unknownApiRequests: mock.unknownApiRequests,
      },
      console: pageConsole,
      pageErrors,
    };
    writeFileSync(
      `${diagnosticDirectory}/diagnostic.json`,
      JSON.stringify(diagnostic, null, 2),
    );
    console.log(`INLINE_EDITOR_PROFILE_RESULT ${JSON.stringify(diagnostic)}`);

    // Intentionally do not release heldProjection: the measured condition is
    // the outstanding unrelated projection request.
    expect(mock.unknownApiRequests).toEqual([]);
  },
);

test("restores the old select value and reports a failed inline save", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page, { recordCount: 200 });

  const initialProjection = mock.armProjectionHold();
  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();
  await initialProjection.seen;
  initialProjection.release();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();

  mock.failNextRecordUpdate();
  await page.getByText("To do", { exact: true }).first().click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await expect.poll(() => mock.recordUpdateRequests.length).toBe(1);
  await expect(page.getByText("Ошибка обновления", { exact: true })).toBeVisible();
  await expect(page.getByText("To do", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toHaveCount(0);
  expect(mock.recordUpdateRequests[0]).toMatchObject({
    expectedVersion: 1,
    valuesJson: { stage: "done" },
  });
  expect(mock.currentRecordVersion()).toBe(1);
  expect(mock.unknownApiRequests).toEqual([]);
});

test("keeps relation search draft open during refresh and sends guarded link writes", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page);

  const initialProjection = mock.armProjectionHold();
  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();
  await initialProjection.seen;
  initialProjection.release();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();

  const relationCell = page
    .locator("main table tbody tr").first()
    .locator("td")
    .filter({ hasText: INITIAL_PROJECT })
    .first();
  await relationCell.locator("button").click();
  const search = page.getByPlaceholder("Поиск записи...");
  await expect(search).toBeVisible();
  await search.fill("candidate draft");
  const candidate = page.getByText("Next project candidate with a long label", { exact: true });
  await expect(candidate).toBeVisible();

  const refreshProjection = mock.armProjectionHold();
  // Dispatching the already-mounted refresh control avoids transferring focus
  // away from the portal input, matching a background refresh notification.
  await page.getByTestId("button-refresh-data-desktop").dispatchEvent("click");
  await refreshProjection.seen;
  await expect(search).toHaveValue("candidate draft");
  await expect(candidate).toBeVisible();
  refreshProjection.release();
  await expect(search).toHaveValue("candidate draft");

  const guardedVersion = mock.currentRecordVersion();
  await candidate.click();
  await expect.poll(() => mock.relatedLinkRequests.length).toBe(1);
  expect(mock.relatedLinkRequests[0]).toMatchObject({
    fieldKey: "project_name",
    recordId: RECORD_ID,
    linkedRecordId: NEXT_RELATED_RECORD_ID,
    expectedVersion: guardedVersion,
  });
  expect(mock.unknownApiRequests).toEqual([]);
});

test("clears an inline editor when navigating to another page for the same entity", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page);

  const initialProjection = mock.armProjectionHold();
  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();
  await initialProjection.seen;
  initialProjection.release();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();

  await page.getByText(INITIAL_TITLE, { exact: true }).click();
  await expect(page.getByTestId("cell-editor-input")).toBeVisible();
  await page.getByTestId("cell-editor-input").fill("draft before scope navigation");

  await page.goto(MIRROR_PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Stable background refresh mirror" })).toBeVisible();
  await expect(page.locator("main table").first()).toBeVisible();
  await expect(page.getByTestId("cell-editor-input")).toHaveCount(0);
  expect(mock.unknownApiRequests).toEqual([]);
});

test("recovers a retained projection after a failed refresh retry", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page);

  const initialProjection = mock.armProjectionHold();
  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();
  await initialProjection.seen;
  initialProjection.release();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(INITIAL_PAGE_NOTE, { exact: true })).toBeVisible();

  mock.markRecordsRefreshed();
  const failedCycleBefore = mock.projectionRequests.length;
  mock.failNextProjection();
  await page.getByTestId("button-refresh-data-desktop").click();
  await expect(page.getByTestId("record-projection-stale")).toBeVisible();
  await expect(page.getByText(INITIAL_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByText(INITIAL_PROJECT, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(INITIAL_PAGE_NOTE, { exact: true })).toBeVisible();
  const staleRow = page.locator("main table tbody tr").first();
  await expect(staleRow.locator("td").nth(3)).toContainText(INITIAL_PROJECT);
  expect(mock.projectionRequests.length).toBe(failedCycleBefore + 1);

  const retryBefore = mock.projectionRequests.length;
  await page
    .getByTestId("record-projection-stale")
    .getByRole("button", { name: "Повторить" })
    .click();
  await expect(page.getByText(REFRESHED_PROJECT, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(REFRESHED_PAGE_NOTE, { exact: true })).toBeVisible();
  await expect(page.getByText(REFRESHED_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("record-projection-stale")).toHaveCount(0);
  expect(mock.projectionRequests.length).toBe(retryBefore + 1);
  expect(mock.unknownApiRequests).toEqual([]);
});

test("keeps grouped totals stable and publishes fresh aggregates before related rows", async ({ page }) => {
  test.setTimeout(90_000);
  const mock = await installMockApi(page, { groupedMode: true });

  const initialProjection = mock.armProjectionHold();
  await page.goto(MIRROR_PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main table").first()).toBeVisible();
  await initialProjection.seen;
  initialProjection.release();

  const table = page.locator("main table").first();
  const totalsRow = table.locator("thead tr").filter({ hasText: "123" }).first();
  const mainHeader = table.locator("thead .erp-main-header");
  const initialGroupRow = table.locator("tbody tr.cursor-pointer").first();
  await expect(totalsRow).toBeVisible();
  await expect(initialGroupRow).toContainText(GROUP_LABEL);
  await expect(initialGroupRow).toContainText("To do");
  expect(mock.recordsQueryRequests[0]).toMatchObject({
    grouped: true,
    pageId: MIRROR_PAGE_ID,
  });

  const initialGeometry = await Promise.all([
    totalsRow.boundingBox(),
    mainHeader.boundingBox(),
    initialGroupRow.boundingBox(),
  ]);
  expect(initialGeometry.every(Boolean)).toBe(true);

  // Expanding the group exercises the normal editable row without changing the
  // server-computed common value shown in the group header.
  await initialGroupRow.getByText(GROUP_LABEL, { exact: true }).click();
  const dataRow = table.locator("tbody tr:not(.cursor-pointer)").first();
  await expect(dataRow).toContainText(INITIAL_TITLE);
  const stageCell = dataRow.locator("td").nth(1);

  const saveHold = mock.armUpdateHold();
  await stageCell.getByText("To do", { exact: true }).click();
  const doneOption = page.getByRole("option", { name: "Done", exact: true });
  await expect(doneOption).toBeVisible();
  const stageCellBefore = await stageCell.boundingBox();
  expect(stageCellBefore).not.toBeNull();
  await doneOption.click();
  await saveHold.seen;
  const savingIndicator = page.getByTestId("inline-saving");
  await expect(savingIndicator).toBeVisible();
  await expect(
    savingIndicator.locator(".sr-only").filter({ hasText: /^(Saving|Сохранение)(…|\.\.\.)?$/ }),
  ).toHaveCount(1);
  await expect(
    savingIndicator.locator(":scope > :not(.sr-only)").filter({ hasText: /Saving|Сохранение/ }),
  ).toHaveCount(0);
  const stageCellDuringSave = await stageCell.boundingBox();
  expect(stageCellDuringSave).not.toBeNull();
  expect(Math.abs(stageCellDuringSave!.width - stageCellBefore!.width)).toBeLessThan(0.5);
  expect(Math.abs(stageCellDuringSave!.height - stageCellBefore!.height)).toBeLessThan(0.5);

  saveHold.release();
  await expect(savingIndicator).toHaveCount(0);
  await expect(initialGroupRow).toContainText("Done");
  // Allow the save's scheduled refreshes to settle before isolating the
  // deliberately gated manual refresh below.
  await page.waitForTimeout(2_000);

  // The records request is paused first. The complete old table, including its
  // totals strip, must remain mounted at exactly the same y coordinates rather
  // than jumping up by one header row.
  const recordsRefresh = mock.armRecordsQueryHold();
  const relatedRefresh = mock.armProjectionHold();
  mock.markRecordsRefreshed();
  await page.getByTestId("button-refresh-data-desktop").click();
  await recordsRefresh.seen;
  await expect(totalsRow).toContainText("123");
  const heldGeometry = await Promise.all([
    totalsRow.boundingBox(),
    mainHeader.boundingBox(),
    initialGroupRow.boundingBox(),
  ]);
  for (let index = 0; index < initialGeometry.length; index += 1) {
    expect(heldGeometry[index]).not.toBeNull();
    expect(Math.abs(heldGeometry[index]!.y - initialGeometry[index]!.y)).toBeLessThan(0.5);
  }

  // Once records/query arrives, its server aggregates are authoritative even
  // though the related projection still gates atomic publication of body rows.
  // In particular, a real numeric zero is retained rather than treated as an
  // absent total.
  recordsRefresh.release();
  await relatedRefresh.seen;
  const refreshedTotalsRow = table.locator("thead tr").filter({ hasText: /^0$/ }).first();
  const refreshedGroupRow = table.locator("tbody tr.cursor-pointer").first();
  await expect(refreshedTotalsRow).toBeVisible();
  await expect(refreshedGroupRow).toContainText("Done");
  await expect(refreshedGroupRow).toContainText(GROUP_LABEL);
  await expect(dataRow).toContainText(INITIAL_TITLE);
  const aggregateGeometry = await Promise.all([
    refreshedTotalsRow.boundingBox(),
    mainHeader.boundingBox(),
    refreshedGroupRow.boundingBox(),
  ]);
  for (let index = 0; index < initialGeometry.length; index += 1) {
    expect(aggregateGeometry[index]).not.toBeNull();
    expect(Math.abs(aggregateGeometry[index]!.y - initialGeometry[index]!.y)).toBeLessThan(0.5);
  }

  relatedRefresh.release();
  await expect(dataRow).toContainText(REFRESHED_TITLE);
  await expect(page.getByTestId("inline-saving")).toHaveCount(0);

  // A search changes the recordsRenderKey even though the entity/page and
  // grouping configuration are unchanged. While that different query scope is
  // held, no common values or sums from the previous group's row may paint.
  const searchRequestCount = mock.recordsQueryRequests.length;
  const searchRefresh = mock.armRecordsQueryHold();
  const searchInput = page.getByPlaceholder("Поиск…");
  await searchInput.fill("different grouped query scope");
  await searchRefresh.seen;
  expect(mock.recordsQueryRequests.length).toBe(searchRequestCount + 1);
  expect(mock.recordsQueryRequests.at(-1)).toMatchObject({
    grouped: true,
    pageId: MIRROR_PAGE_ID,
    search: "different grouped query scope",
  });
  await expect(table.locator("tbody tr.cursor-pointer")).toHaveCount(0);
  await expect(page.getByText(GROUP_LABEL, { exact: true })).toHaveCount(0);
  searchRefresh.release();
  await expect(table.locator("tbody tr.cursor-pointer").first()).toContainText(GROUP_LABEL);

  const clearSearchRequestCount = mock.recordsQueryRequests.length;
  await searchInput.fill("");
  await expect.poll(() => mock.recordsQueryRequests.length).toBeGreaterThan(clearSearchRequestCount);
  await expect(table.locator("tbody tr.cursor-pointer").first()).toContainText(GROUP_LABEL);

  // A same-scope failure leaves the last successful zero total in place and
  // offers retry. Crossing to another page scope must hide it immediately.
  mock.failNextRecordsQuery();
  await page.getByTestId("button-refresh-data-desktop").click();
  await expect(page.getByText("Ошибка загрузки записей", { exact: true })).toBeVisible();
  await expect(refreshedTotalsRow).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" }).first()).toBeVisible();

  await page.goto(PAGE_PATH, { waitUntil: "domcontentloaded" });
  await expect(refreshedTotalsRow).toHaveCount(0);
  expect(mock.unknownApiRequests).toEqual([]);
});