import app from "./app";
import { logger } from "./lib/logger";
import { ensureAiAgentsModule } from "./routes/ai-agents";

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

// Seed the system module row (idempotent); the server still starts if it fails.
ensureAiAgentsModule().catch((err) => logger.error({ err }, "Failed to seed ai_agents module"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
