import { Logger } from '@nestjs/common';
import { Worker } from 'node:worker_threads';

/**
 * Kills the process when its event loop stops turning.
 *
 * A heap OOM once left node hung at 100% CPU for 13 hours instead of
 * exiting. The memory guard leaves before that point, and Docker marks a
 * process that stops answering its healthcheck unhealthy — but Docker never
 * restarts an unhealthy container, and the host watchdog that does is a copy
 * installed by hand. This thread has its own isolate and event loop, so it
 * keeps running while the main one is stuck, and a SIGKILL ends the process;
 * `restart: unless-stopped` brings the container back.
 *
 * Needs `init: true` in compose: the kernel ignores a SIGKILL sent from inside
 * the container to its PID 1, which node is without an init.
 */
export function startEventLoopWatchdog(options: {
  stallMs: number;
  pingEveryMs?: number;
}) {
  const pingEveryMs = options.pingEveryMs ?? 5_000;
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    let last = Date.now();
    parentPort.on('message', () => { last = Date.now(); });
    setInterval(() => {
      const silent = Date.now() - last;
      if (silent > workerData.stallMs) {
        // fs.writeSync, not process.stderr: a thread's stderr is relayed by
        // the main thread, which is exactly the one that is stuck.
        require('node:fs').writeSync(2, 'Event loop stalled for ' + silent + ' ms; killing the process\\n');
        process.kill(process.pid, 'SIGKILL');
      }
    }, workerData.checkEveryMs);
  `;
  const thread = new Worker(source, {
    eval: true,
    workerData: {
      stallMs: options.stallMs,
      checkEveryMs: Math.min(pingEveryMs, options.stallMs),
    },
  });
  thread.on('error', (error) =>
    new Logger('EventLoopWatchdog').error(
      `Watchdog thread failed: ${error.message}`,
    ),
  );
  thread.unref();
  const timer = setInterval(() => thread.postMessage(0), pingEveryMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    void thread.terminate();
  };
}
