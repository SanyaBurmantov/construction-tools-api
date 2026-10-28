import { PrismaService } from '../prisma/prisma.service';

/** `SiteSetting` key the worker stamps; the API reads it. */
export const WORKER_HEARTBEAT_KEY = 'worker.heartbeatAt';
/** How often the worker stamps it. */
export const WORKER_HEARTBEAT_EVERY_MS = 30_000;
/**
 * Silence after which the worker counts as dead: several missed beats, so a
 * long synchronous parse or a slow DB moment is not reported as a death.
 */
export const WORKER_DEAD_AFTER_MS = 3 * 60_000;

export type WorkerHeartbeat = { alive: boolean; lastSeenAt: Date | null };

export function isWorkerAlive(
  lastSeenAt: Date | null,
  now = Date.now(),
): boolean {
  return (
    lastSeenAt !== null && now - lastSeenAt.getTime() <= WORKER_DEAD_AFTER_MS
  );
}

export async function readWorkerHeartbeat(
  prisma: PrismaService,
): Promise<WorkerHeartbeat> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: WORKER_HEARTBEAT_KEY },
  });
  const parsed = row ? new Date(row.value) : null;
  const lastSeenAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  return { alive: isWorkerAlive(lastSeenAt), lastSeenAt };
}
