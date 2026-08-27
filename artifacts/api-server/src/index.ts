import app from "./app";
import { logger } from "./lib/logger";
import { migrateLegacyUploads, UPLOADS_ROOT } from "./lib/localStorage";
import { ensureAiAgentsModule } from "./routes/ai-agents";
import { ensureInboundIntegrationsModule, recoverInboundDeliveries } from "./routes/inbound-integrations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  try {
    const movedFiles = await migrateLegacyUploads();
    logger.info({ uploadsRoot: UPLOADS_ROOT, movedFiles }, "Local uploads directory ready");
  } catch (err) {
    logger.error({ err, uploadsRoot: UPLOADS_ROOT }, "Failed to migrate legacy local uploads");
  }

  // Seed the system module row (idempotent); the server still starts if it fails.
  ensureAiAgentsModule().catch((err) => logger.error({ err }, "Failed to seed ai_agents module"));
  ensureInboundIntegrationsModule().catch((err) => logger.error({ err }, "Failed to seed inbound_integrations module"));
  // Durable delivery rows are reclaimed on startup and periodically; the
  // webhook handler only persists and returns 202.
  recoverInboundDeliveries().catch((err) => logger.error({ err }, "Failed to recover inbound deliveries"));
  setInterval(() => void recoverInboundDeliveries().catch((err) => logger.error({ err }, "Failed to poll inbound deliveries")), 15_000).unref();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void start();
