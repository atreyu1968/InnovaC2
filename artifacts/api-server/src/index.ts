import app from "./app";
import { logger } from "./lib/logger";
import { ensureReferenceData } from "./lib/reference-data";
import { sessionSecret } from "./lib/auth";
import { ensureDataDirectory } from "./lib/storage";

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
  sessionSecret();
  await ensureDataDirectory();
  await ensureReferenceData();
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });
}

start().catch((err: unknown) => {
  logger.fatal({ err }, "Server startup failed");
  process.exit(1);
});
