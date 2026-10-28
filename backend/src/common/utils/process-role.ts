/**
 * Which half of the backend this process is.
 *
 * - `api` — HTTP only: no crons, no boot passes, no parsing. A parser job an
 *   admin asks for is written to `ParserJobRequest` for the worker to run.
 * - `worker` — `main.worker.ts`: crons, parsers, AI tasks and the boot passes,
 *   no HTTP. It is the only process that talks to suppliers.
 * - `all` (unset) — both in one process: `npm run start:dev` and the tests.
 *
 * Read from the real environment (docker-compose sets it), so it is known
 * while modules are still being declared.
 */
export type ProcessRole = 'all' | 'api' | 'worker';

export function processRole(): ProcessRole {
  const value = process.env.PROCESS_ROLE?.trim().toLowerCase();
  return value === 'api' || value === 'worker' ? value : 'all';
}

/** Crons, parser jobs, AI runner and the passes that run once after boot. */
export function runsBackgroundJobs(): boolean {
  return processRole() !== 'api';
}

/** Serves HTTP, and owns the things that belong to it (admin bootstrap). */
export function servesHttp(): boolean {
  return processRole() !== 'worker';
}
