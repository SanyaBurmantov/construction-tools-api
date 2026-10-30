import { ServiceUnavailableException } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';

describe('recommendations under load', () => {
  const service = () => {
    const s = new RecommendationsService({} as never);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let running = 0;
    let peak = 0;
    (s as unknown as { compute: () => Promise<unknown> }).compute =
      async () => {
        calls += 1;
        running += 1;
        peak = Math.max(peak, running);
        await gate;
        running -= 1;
        return { calls };
      };
    return { s, release, stats: () => ({ calls, peak }) };
  };

  it('computes at most six at once, queues forty, refuses the rest quickly', async () => {
    const { s, release, stats } = service();
    const answers = Array.from({ length: 60 }, (_, i) =>
      s.get(`slug-${i}`, { accessoriesPage: 1, fitsPage: 1 }).then(
        () => 'ok',
        (error: unknown) =>
          error instanceof ServiceUnavailableException ? '503' : 'error',
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(stats().peak).toBe(6);
    release();
    const results = await Promise.all(answers);
    expect(results.filter((r) => r === 'ok')).toHaveLength(46);
    expect(results.filter((r) => r === '503')).toHaveLength(14);
    expect(stats().peak).toBeLessThanOrEqual(7);
  });

  it('answers a repeat of the same card from the cache', async () => {
    const { s, release, stats } = service();
    release();
    await s.get('a', { accessoriesPage: 1, fitsPage: 1 });
    await s.get('a', { accessoriesPage: 1, fitsPage: 1 });
    await s.get('a', { accessoriesPage: 2, fitsPage: 1 });
    expect(stats().calls).toBe(2);
  });
});
