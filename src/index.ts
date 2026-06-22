import { SyncService } from "./services/syncService.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const service = new SyncService();
  const stats = await service.run();

  logger.info({ stats }, "todoist to notion sync finished");

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.fatal({ error }, "todoist to notion sync failed");
  process.exitCode = 1;
});
