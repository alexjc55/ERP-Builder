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
        "for kind=gdrive via GET /google-drive/files/{fileId}/content; for kind=link just give the url to the user.",
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
            "Main search endpoint. `search` does a fuzzy text search over text/select fields. `filters` is an array of {field: fieldKey, operator, value}; " +
            "operators include eq, neq, contains, gt, gte, lt, lte, is_empty, is_not_empty. Dates are ISO strings — for 'about 2 years ago' use a gte/lte range on a date field " +
            "or on the reserved key `__created_at__`. `sorts`: [{field, direction: asc|desc}] (reserved sort key `__created_at__` sorts by creation time). " +
            "`statusIds`: restrict by workflow status. Pagination: page (1-based), pageSize (max 100). Response contains rows with id, statusId, createdAt and valuesJson keyed by fieldKey.",
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
          responses: { "200": { description: "Matching records", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/records/{id}": {
        get: {
          operationId: "getRecord",
          summary: "Get one record with all values",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Record", content: { "application/json": { schema: { type: "object" } } } } },
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
