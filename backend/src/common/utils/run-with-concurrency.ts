/**
 * Bounded concurrency over a list.
 *
 * A failing item does not stop its siblings mid-flight: every worker drains
 * the queue, and the first error is rethrown only once all of them have
 * stopped. With `Promise.all` over the workers, one rejection settled the
 * call while another worker was still parsing — the caller released its job
 * lock and the next run started on top of the unfinished one.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  await mapWithConcurrency(items, concurrency, task);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  const errors: unknown[] = [];
  // Indexes, not items: `if (item)` silently skipped falsy items (0, '').
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        try {
          results[index] = await task(items[index]);
        } catch (error) {
          errors.push(error);
        }
      }
    },
  );

  await Promise.all(workers);
  if (errors.length) throw errors[0];
  return results;
}
