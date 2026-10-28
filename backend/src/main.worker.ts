import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { installMemoryGuard } from './common/utils/install-memory-guard';
import { startEventLoopWatchdog } from './common/utils/event-loop-watchdog';

/**
 * The worker: every cron, the supplier parsers, the AI runner and the boot
 * passes, in a process of its own with its own container and memory ceiling.
 *
 * They used to share the API's Node process and its 512 MB heap, so a parser
 * batch that ate memory took the storefront down with it (the 13-hour hang).
 * Same code and same image; `PROCESS_ROLE=worker` and an application context
 * instead of an HTTP server. Admin "run now" requests arrive through the
 * `ParserJobRequest` table (ParserJobRequestService).
 */
// docker-compose sets it as well. Here it covers `node dist/main.worker` run
// by hand; the role is only ever read at runtime (module declaration happens
// in the hoisted imports, where `worker` and an unset role mean the same).
process.env.PROCESS_ROLE = 'worker';

const logger = new Logger('Worker');

// Same safety net as the API: a stray rejection from a background job must
// not end the process.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${String(reason)}`);
});

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  try {
    await app.get(PrismaService).$executeRawUnsafe('SELECT 1');
  } catch (error) {
    logger.error(`Database connection failed: ${String(error)}`);
    process.exit(1);
  }

  logger.log('Worker is running: crons, parsers and AI tasks');
  await installMemoryGuard(app, 'worker');

  // A parse is CPU work between awaits, never minutes of it: a loop silent
  // this long is hung, not busy. WORKER_STALL_KILL_MS=0 disables.
  const stallMs = Number(process.env.WORKER_STALL_KILL_MS ?? 180_000);
  if (stallMs > 0) startEventLoopWatchdog({ stallMs });
}
void bootstrap();
