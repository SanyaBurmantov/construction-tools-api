import { startHeapSampling, topRetainers } from './heap-profile';

const held: string[][] = [];

function holdLotsOfStrings() {
  const chunk: string[] = [];
  for (let i = 0; i < 200_000; i++) chunk.push(`row-${i}-${'x'.repeat(40)}`);
  held.push(chunk);
}

describe('heap sampling', () => {
  it('names the function that holds the heap', async () => {
    await startHeapSampling(32 * 1024);
    holdLotsOfStrings();
    const top = await topRetainers(5);
    expect(held).toHaveLength(1);
    expect(top.length).toBeGreaterThan(0);
    const mine = top.find(
      (r) =>
        r.site.includes('holdLotsOfStrings') ||
        r.stack.includes('holdLotsOfStrings'),
    );
    expect(mine).toBeDefined();
    expect(mine!.mb).toBeGreaterThan(5);
  });
});
