import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Runs the watchdog in a child process and blocks that child's event loop:
 * the watchdog thread must kill it. (Not PID 1 here, so SIGKILL lands.)
 */
describe('startEventLoopWatchdog', () => {
  it('kills a process whose event loop is stuck', () => {
    const modulePath = join(__dirname, 'event-loop-watchdog.ts');
    const script = `
      require('ts-node/register/transpile-only');
      const { startEventLoopWatchdog } = require(${JSON.stringify(modulePath)});
      startEventLoopWatchdog({ stallMs: 300, pingEveryMs: 50 });
      setTimeout(() => { const end = Date.now() + 10000; while (Date.now() < end) {} process.exit(0); }, 200);
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 15_000,
    });

    expect(result.signal).toBe('SIGKILL');
    expect(result.stderr).toContain('Event loop stalled');
  });

  it('leaves a healthy process alone', () => {
    const modulePath = join(__dirname, 'event-loop-watchdog.ts');
    const script = `
      require('ts-node/register/transpile-only');
      const { startEventLoopWatchdog } = require(${JSON.stringify(modulePath)});
      startEventLoopWatchdog({ stallMs: 300, pingEveryMs: 50 });
      const keep = setInterval(() => {}, 20);
      setTimeout(() => { clearInterval(keep); process.exit(0); }, 1000);
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 15_000,
    });

    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  });
});
