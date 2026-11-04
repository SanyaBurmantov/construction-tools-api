import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Database operations per HTTP request — the N+1 detector. The timing
 * middleware opens a store per request; PrismaService counts every
 * operation into it (`$use`). 24 cards loading their brand one by one show
 * up as a route averaging 25 queries where 2 would do — no profiler needed.
 * Outside a request (crons, the worker) there is no store and nothing counts.
 */
export const queryContext = new AsyncLocalStorage<{ queries: number }>();

export function countQuery() {
  const store = queryContext.getStore();
  if (store) store.queries += 1;
}
