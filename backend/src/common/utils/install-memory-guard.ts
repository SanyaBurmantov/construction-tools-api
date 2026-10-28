import { INestApplicationContext, Logger } from '@nestjs/common';
import { startMemoryGuard } from './memory-guard';
import { startHeapSampling, topRetainers } from './heap-profile';
import { TelegramService } from '../../notifications/telegram.service';

/**
 * The memory guard, wired the same way in both processes (`main.ts` for the
 * API, `main.worker.ts` for the worker): restart cleanly before a heap OOM —
 * the real one hung node for 13 h instead of ending it (see memory-guard.ts) —
 * and report what holds the heap. `MEMORY_GUARD_MAX_HEAP_RATIO=0` disables.
 */
export async function installMemoryGuard(
  app: INestApplicationContext,
  processName: string,
) {
  const logger = new Logger('MemoryGuard');
  const maxHeapRatio = Number(process.env.MEMORY_GUARD_MAX_HEAP_RATIO ?? 0.85);
  if (!(maxHeapRatio > 0)) return;

  // Sampling heap profiler (~1% overhead): when the heap gets high, the log
  // and the alerts topic say which code holds it — the 2026-10-27 OOM left
  // nothing but a V8 stack in StreamBase::Writev to go on.
  await startHeapSampling().catch((error) =>
    logger.warn(`Heap sampling unavailable: ${String(error)}`),
  );
  const telegram = app.get(TelegramService);
  startMemoryGuard({
    maxHeapRatio,
    warnRatio: Number(process.env.MEMORY_GUARD_WARN_HEAP_RATIO ?? 0.6),
    report: async (reason, describe) => {
      const top = await topRetainers(12);
      const lines = top.map(
        (r) => `${r.mb} MB  ${r.site}${r.stack ? `  ← ${r.stack}` : ''}`,
      );
      logger.warn(
        `${processName} heap ${reason === 'restart' ? 'before restart' : 'high'}: ${describe}\n` +
          lines.join('\n'),
      );
      await telegram.notifyMemoryReport(
        reason,
        `${processName}: ${describe}`,
        lines,
      );
    },
    checkEveryMs: 15_000,
    reportEveryMs: 15 * 60_000,
    close: () => app.close(),
    closeTimeoutMs: 15_000,
  });
}
