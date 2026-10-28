import { Logger } from '@nestjs/common';
import { getHeapStatistics } from 'node:v8';

const logger = new Logger('MemoryGuard');

export interface MemoryGuardOptions {
  /** Share of V8's heap limit at which the process restarts itself. */
  maxHeapRatio: number;
  checkEveryMs: number;
  /** How often a plain usage line goes to the log (0 = never). */
  reportEveryMs: number;
  /**
   * Called once per process when the heap first crosses `warnRatio`, and
   * again (awaited, inside the shutdown timeout) right before a restart —
   * the moment to say what is holding the memory.
   */
  warnRatio?: number;
  report?: (reason: 'warn' | 'restart', describe: string) => Promise<void>;
  /** Graceful shutdown; the guard exits regardless after `closeTimeoutMs`. */
  close: () => Promise<unknown>;
  closeTimeoutMs: number;
  exit?: (code: number) => void;
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

export function heapUsage() {
  const { used_heap_size, heap_size_limit } = getHeapStatistics();
  const { rss, external, arrayBuffers } = process.memoryUsage();
  return {
    usedMb: mb(used_heap_size),
    limitMb: mb(heap_size_limit),
    ratio: used_heap_size / heap_size_limit,
    rssMb: mb(rss),
    externalMb: mb(external + arrayBuffers),
  };
}

export function shouldRestart(ratio: number, maxHeapRatio: number) {
  return ratio >= maxHeapRatio;
}

/**
 * Exits the process before V8 runs out of heap.
 *
 * A heap OOM in production did not end the process: node printed
 * "Reached heap limit" and then hung at 100% CPU for 13 hours, still "Up" to
 * Docker, so `restart: unless-stopped` never fired and Docker does not restart
 * an `unhealthy` container on its own. The whole catalogue was a 502.
 * Leaving at a controlled threshold turns that into a restart of a few
 * seconds: in-flight parser rows are claimed with a lease and are picked up
 * again, and a run left RUNNING is reset at boot.
 */
export function startMemoryGuard(options: MemoryGuardOptions) {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let lastReport = Date.now();
  let leaving = false;
  let warned = false;
  const report = (reason: 'warn' | 'restart', describe: string) =>
    (options.report?.(reason, describe) ?? Promise.resolve()).catch((error) =>
      logger.error(`Memory report failed: ${String(error)}`),
    );

  const timer = setInterval(() => {
    if (leaving) return;
    const usage = heapUsage();
    const describe = `heap ${usage.usedMb}/${usage.limitMb} MB, rss ${usage.rssMb} MB, external ${usage.externalMb} MB`;

    if (shouldRestart(usage.ratio, options.maxHeapRatio)) {
      leaving = true;
      clearInterval(timer);
      logger.error(
        `Heap at ${Math.round(usage.ratio * 100)}% (${describe}) — restarting before V8 runs out of memory`,
      );
      const hardExit = setTimeout(() => exit(1), options.closeTimeoutMs);
      hardExit.unref();
      report('restart', describe)
        .then(() => options.close())
        .catch((error) => logger.error(`Shutdown failed: ${String(error)}`))
        .finally(() => exit(1));
      return;
    }

    if (
      !warned &&
      options.warnRatio !== undefined &&
      usage.ratio >= options.warnRatio
    ) {
      warned = true;
      logger.warn(`Heap at ${Math.round(usage.ratio * 100)}% (${describe})`);
      void report('warn', describe);
    }

    if (
      options.reportEveryMs > 0 &&
      Date.now() - lastReport >= options.reportEveryMs
    ) {
      lastReport = Date.now();
      logger.log(describe);
    }
  }, options.checkEveryMs);
  timer.unref();
  return timer;
}
