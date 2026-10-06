import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { securityAuditContext, securityAuditStart } from "./lib/security-audit";
import { initAutomations } from "./lib/automations-engine";
import { inboundWebhookRouter } from "./routes/inbound-integrations";
import {
  ActiveRequestTracker,
  isMemoryDiagnosticsEnabled,
} from "./lib/memory-diagnostics";

const app: Express = express();
export const activeRequestTracker = new ActiveRequestTracker();

initAutomations();

if (isMemoryDiagnosticsEnabled()) {
  app.use(activeRequestTracker.middleware);
}

app.use(
  pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use("/api", securityAuditContext);
app.use("/api/webhooks/inbound", express.raw({ type: "application/json", limit: "5mb" }));
app.use("/api/webhooks/inbound", securityAuditStart);
app.use(inboundWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", securityAuditStart, router);

export default app;
