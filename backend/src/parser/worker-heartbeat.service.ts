import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { writeFile } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { runsBackgroundJobs } from '../common/utils/process-role';
import {
  WORKER_HEARTBEAT_EVERY_MS,
  WORKER_HEARTBEAT_KEY,
} from './worker-heartbeat';

/**
 * The worker's proof of life, in two places:
 * - `SiteSetting worker.heartbeatAt`, which the API reads — `/health/parser`,
 *   `/admin/parsing`, and the refusal of a job request nobody would pick up;
 * - a file the container healthcheck checks for freshness. The worker has no
 *   HTTP to probe, and a hung event loop (the heap-OOM hang the API once had)
 *   stops touching it, so Docker marks the container unhealthy and
 *   `deploy/watchdog.sh` restarts it.
 */
export const WORKER_HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker-heartbeat';

@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerHeartbeatService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (runsBackgroundJobs()) await this.beat();
  }

  @Interval(WORKER_HEARTBEAT_EVERY_MS)
  async beat() {
    const now = new Date();
    // The file first: it answers "is the event loop alive", which must not
    // depend on the database being reachable.
    await writeFile(WORKER_HEARTBEAT_FILE, now.toISOString()).catch(
      () => undefined,
    );
    await this.prisma.siteSetting
      .upsert({
        where: { key: WORKER_HEARTBEAT_KEY },
        update: { value: now.toISOString() },
        create: { key: WORKER_HEARTBEAT_KEY, value: now.toISOString() },
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Heartbeat not recorded: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }
}
