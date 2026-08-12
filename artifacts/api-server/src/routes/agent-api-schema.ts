import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();

/**
 * Trimmed, agent-facing OpenAPI schema for external LLM agents (ChatGPT
 * Actions, etc.). The full platform spec has hundreds of operations — far
 * beyond the ~30-operation limit of GPT Actions — so this endpoint serves a
 * hand-picked read/search/file subset with rich descriptions the LLM can use
 * to plan calls.
 *
 * Public by design: it exposes only the API SHAPE (no data, no keys). Every
 * described operation itself requires the agent's Bearer key and passes the
 * full RBAC boundary.
 */
router.get("/agent-api/schema", (req, res): void => {
  res.json(buildAgentSchema(req));
});

function baseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol || "https";
  const host = req.get("host") ?? "localhost";
  return `${proto}://${host}/api`;
}

const ML = {
  type: "object",
  description: "Multilingual text: { ru, en, he } (any subset).",
  properties: { ru: { type: "string" }, en: { type: "string" }, he: { type: "string" } },
} as const;

/**
 * Shape of a record as the API actually returns it (entity_records row after
 * presentRecord: hidden fields stripped, system created_at fields injected
 * into valuesJson). valuesJson keys are dynamic (per-entity fieldKeys), which
 * OpenAPI expresses via additionalProperties.
 */
const RECORD = {
  type: "object",
  properties: {
    id: { type: "integer" },
    entityId: { type: "integer" },
    statusId: { type: ["integer", "null"], description: "Workflow status id (see /entities/{entityId}/statuses)." },
    valuesJson: {
      type: "object",
      description: "Field values keyed by fieldKey (see /entities/{entityId}/fields). Values may be strings, numbers, booleans, arrays or file objects.",
      additionalProperties: true,
    },
    archivedAt: { type: ["string", "null"], description: "ISO timestamp if the record is archived, else null." },
    statusChangedAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
} as const;

function buildAgentSchema(req: Request): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "ERP Agent API",
      version: "1.0.0",
      description:
        "Read/search subset of the ERP API for AI agents. Auth: send the agent key as `Authorization: Bearer agk_...` on every request. " +
        "Typical flow: 1) GET /entities to find the entity (e.g. Заказы/Orders); 2) GET /entities/{entityId}/fields and /statuses to learn field keys, labels (ru/en/he) and status ids; " +
        "3) POST /entities/{entityId}/records/query to search records by text, field filters and dates; 4) GET /records/{id} for full record values; " +
        "5) GET /records/{id}/audit for change history — status changes have fieldKey \"__status__\" with timestamps (when the order moved to production, painting, shipping, etc.); " +
        "6) download files referenced in record file-field values. A file value is an object or array of objects like {\"kind\":\"server\",\"path\":\"/local/...\",\"name\":\"drawing.pdf\"} " +
        "or {\"kind\":\"gdrive\",\"fileId\":\"...\",\"name\":\"...\"} or {\"kind\":\"link\",\"url\":\"https://...\"}. " +
        "For kind=server (or legacy values with only a path) download via GET /storage/local/{path-after-/local/} or GET /storage/objects/{path-after-/objects/}; " +
        "for kind=gdrive via GET /google-drive/files/{fileId}/content; for kind=link just give the url to the user. " +
        "Query details (queryRecords): filter operators are eq, neq, contains, gt, gte, lt, lte, is_empty, is_not_empty; `filterConjunction` is and|or; " +
        "for 'about 2 years ago' use a gte/lte range on a date field or on `__created_at__`; `sorts` items are {field, direction: asc|desc}; " +
        "the response is {data: Record[], total} where each record has id, statusId, createdAt and valuesJson keyed by fieldKey. " +
        "IMPORTANT — linked records: relations between records (e.g. project ↔ its orders/items) are NOT stored in valuesJson and cannot be found by text search on the other entity. " +
        "After finding a record's id, call GET /records/{id}/links?direction=both to get ALL records linked to it (its orders, items, etc.) with their full valuesJson, then filter/read them locally. " +
        "Archive: archived records are EXCLUDED from queryRecords by default; if something is not found, retry with \"archived\": true — closed/old orders are often archived, not absent. " +
        "Page-local fields: some pages add their OWN extra fields to records (stored separately from entity fields). To get the complete picture of a record, also check GET /pages, then " +
        "GET /pages/{pageId}/fields and GET /pages/{pageId}/record-values for pages of that entity, and merge those values with the record's valuesJson by recordId.",
    },
    servers: [{ url: baseUrl(req) }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: { MultilingualText: ML },
    },
    paths: {
      "/entities": {
        get: {
          operationId: "listEntities",
          summary: "List entities (data tables) visible to the agent",
          description: "Returns entities with id and multilingual nameJson. Use the id in all other calls.",
          responses: { "200": { description: "Entities", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/entities/{entityId}/fields": {
        get: {
          operationId: "listFields",
          summary: "List fields of an entity",
          description:
            "Each field has fieldKey (use it in filters/sorts and to read values from valuesJson), nameJson (ru/en/he label) and fieldType " +
            "(text, number, date, select, file, relation, user, ...). File-type fields hold downloadable documents such as drawings.",
          parameters: [{ name: "entityId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Fields", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/entities/{entityId}/statuses": {
        get: {
          operationId: "listStatuses",
          summary: "List workflow statuses of an entity",
          description: "Statuses have id and multilingual nameJson (e.g. Производство/Покраска/Отправлен). Use ids in query statusIds.",
          parameters: [{ name: "entityId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Statuses", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/entities/{entityId}/records/query": {
        post: {
          operationId: "queryRecords",
          summary: "Search records (text search, filters, sort, pagination)",
          description:
            "Main search endpoint: text `search`, `filters` [{field: fieldKey, operator, value}], `statusIds`, `sorts`, pagination (page 1-based, pageSize max 100). " +
            "Dates are ISO strings; reserved key `__created_at__` filters/sorts by creation time. See the API description for details.",
          parameters: [{ name: "entityId", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    search: { type: "string" },
                    filters: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { field: { type: "string" }, operator: { type: "string" }, value: {} },
                        required: ["field", "operator"],
                      },
                    },
                    filterConjunction: { type: "string", enum: ["and", "or"] },
                    statusIds: { type: "array", items: { type: "integer" } },
                    sorts: {
                      type: "array",
                      items: { type: "object", properties: { field: { type: "string" }, direction: { type: "string", enum: ["asc", "desc"] } } },
                    },
                    archived: { type: "boolean", description: "true = search archived records too" },
                    page: { type: "integer" },
                    pageSize: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Matching records",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: RECORD },
                      total: { type: "integer", description: "Total number of matching records (across all pages)." },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/records/{id}": {
        get: {
          operationId: "getRecord",
          summary: "Get one record with all values",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Record", content: { "application/json": { schema: RECORD } } } },
        },
      },
      "/records/{id}/links": {
        get: {
          operationId: "listRecordLinks",
          summary: "Get all records LINKED to a record (e.g. orders/items of a project)",
          description:
            "The primary way to traverse relations. Always pass direction=both. Returns linked records from other entities with full valuesJson; " +
            "check each item's record.entityId to know which entity it belongs to. Rows the agent's role may not see are omitted.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            { name: "direction", in: "query", required: false, schema: { type: "string", enum: ["both"] }, description: "Use 'both' to include links in either direction." },
          ],
          responses: {
            "200": {
              description: "Linked records",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        linkId: { type: "integer" },
                        relationId: { type: "integer" },
                        direction: { type: "string", enum: ["source", "target"] },
                        record: RECORD,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/pages": {
        get: {
          operationId: "listPages",
          summary: "List pages (a page can add page-local extra fields to an entity's records)",
          description:
            "To find the pages of an entity: the entity object from /entities has pageId (its main page), and a page with mirrorEntityId=<entityId> is a mirror page of that entity. " +
            "Pages without an entity return 400 from record-values — skip them.",
          responses: { "200": { description: "Pages", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/pages/{pageId}/fields": {
        get: {
          operationId: "listPageFields",
          summary: "List page-local fields of a page",
          description: "Page-local fields are EXTRA columns stored per page, not in the record's valuesJson. Use fieldKey to read values from record-values.",
          parameters: [{ name: "pageId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Page fields", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/pages/{pageId}/record-values": {
        get: {
          operationId: "listPageRecordValues",
          summary: "Page-local field values for records of a page",
          description: "Returns [{recordId, valuesJson}] with the page's OWN field values. Merge with the record's entity valuesJson by recordId for the full picture.",
          parameters: [{ name: "pageId", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": {
              description: "Page-local values",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        recordId: { type: "integer" },
                        valuesJson: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/records/{id}/audit": {
        get: {
          operationId: "getRecordHistory",
          summary: "Change history of a record (incl. status transitions with dates)",
          description:
            "Newest first. Entries with fieldKey \"__status__\" are workflow transitions: use their createdAt timestamps to answer 'when did the order go to production / painting / shipping'.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Audit entries", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/storage/local/{filePath}": {
        get: {
          operationId: "downloadLocalFile",
          summary: "Download a server-stored file (PDF drawing, photo, ...)",
          description: "filePath is the file-value `path` WITHOUT the leading `/local/`. Returns the binary file.",
          parameters: [{ name: "filePath", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "File binary" } },
        },
      },
      "/storage/objects/{filePath}": {
        get: {
          operationId: "downloadLegacyObjectFile",
          summary: "Download a legacy object-storage file",
          description: "For file values whose path starts with `/objects/`; filePath is the part after `/objects/`.",
          parameters: [{ name: "filePath", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "File binary" } },
        },
      },
      "/google-drive/files/{fileId}/content": {
        get: {
          operationId: "downloadDriveFile",
          summary: "Download a Google Drive file referenced by a record",
          parameters: [{ name: "fileId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "File binary" } },
        },
      },
    },
  };
}

export default router;
