export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), queue.length) },
    async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await task(item);
      }
    },
  );

  await Promise.all(workers);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), queue.length) },
    async () => {
      while (queue.length) {
        const next = queue.shift();
        if (next) results[next.index] = await task(next.item);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
