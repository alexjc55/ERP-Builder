import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { initAutomations } from "./lib/automations-engine";
import { inboundWebhookRouter } from "./routes/inbound-integrations";

const app: Express = express();

initAutomations();

app.use(
  pinoHttp({
    logger,
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
app.use("/api/webhooks/inbound", express.raw({ type: "application/json", limit: "5mb" }));
app.use(inboundWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
