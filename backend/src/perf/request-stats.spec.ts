import {
  Controller,
  Get,
  MiddlewareConsumer,
  Module,
  Param,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PerfService } from './perf.service';
import { RequestTimingMiddleware } from './request-timing.middleware';
import {
  N_PLUS_ONE_QUERIES,
  percentile,
  RequestStats,
  routeTemplate,
} from './request-stats';
import { countQuery } from './query-context';

describe('RequestStats', () => {
  it('aggregates per route with percentiles and keeps slow requests', () => {
    const stats = new RequestStats();
    for (let i = 1; i <= 100; i++) {
      stats.record({
        method: 'GET',
        route: '/products',
        url: `/products?page=${i}`,
        status: 200,
        ms: i * 10,
        now: 1_000,
      });
    }
    stats.record({
      method: 'GET',
      route: '/products/:slug',
      url: '/products/a',
      status: 500,
      ms: 5,
      now: 1_000,
    });
    const [heavy, light] = stats.routesTable();
    expect(heavy).toMatchObject({
      route: 'GET /products',
      count: 100,
      avgMs: 505,
      p50Ms: 500,
      p95Ms: 950,
      maxMs: 1000,
      slow: 1,
    });
    expect(light).toMatchObject({ route: 'GET /products/:slug', errors: 1 });
    expect(stats.recentSlow()).toEqual([
      expect.objectContaining({
        route: '/products',
        url: '/products?page=100',
        ms: 1000,
      }),
    ]);
  });

  it('counts slow requests in a sliding window', () => {
    const stats = new RequestStats();
    stats.record({
      method: 'GET',
      route: '/a',
      url: '/a',
      status: 200,
      ms: 2000,
      now: 0,
    });
    stats.record({
      method: 'GET',
      route: '/a',
      url: '/a',
      status: 200,
      ms: 3000,
      now: 400_000,
    });
    expect(stats.slowInWindow(300_000, 500_000)).toBe(1);
    expect(stats.slowRoutesInWindow(300_000, 500_000)[0]).toMatchObject({
      route: 'GET /a',
      count: 1,
      maxMs: 3000,
    });
  });

  it('percentile handles empty and small samples', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it('averages DB operations per route', () => {
    const stats = new RequestStats();
    for (const queries of [2, 30, 31])
      stats.record({
        method: 'GET',
        route: '/x',
        url: '/x',
        status: 200,
        ms: 5,
        queries,
      });
    const [row] = stats.routesTable();
    expect(row.avgQueries).toBe(21);
    expect(row.maxQueries).toBe(31);
    expect(row.avgQueries).toBeGreaterThan(N_PLUS_ONE_QUERIES);
  });

  it('measures each SLO on its own routes', () => {
    const stats = new RequestStats();
    for (let i = 0; i < 99; i++)
      stats.record({
        method: 'GET',
        route: '/products/:slug',
        url: '/p',
        status: 200,
        ms: 100,
      });
    stats.record({
      method: 'GET',
      route: '/products/:slug',
      url: '/p',
      status: 200,
      ms: 3000,
    });
    stats.record({
      method: 'POST',
      route: '/orders',
      url: '/orders',
      status: 500,
      ms: 50,
    });
    const [catalogue, checkout, all] = stats.sloReport();
    expect(catalogue).toMatchObject({
      sampled: 100,
      fastShare: 0.99,
      ok: true,
    });
    // One 5xx out of one checkout is far over its 0.1% budget.
    expect(checkout).toMatchObject({ requests: 1, errorShare: 1, ok: false });
    expect(all.requests).toBe(101);
  });

  it('pools unmatched paths', () => {
    expect(routeTemplate({})).toBe('(не найден маршрут)');
    expect(routeTemplate({ route: { path: '/x/:id' }, baseUrl: '' })).toBe(
      '/x/:id',
    );
  });
});

@Controller('things')
class ThingsController {
  @Get(':id')
  async one(@Param('id') id: string) {
    // Three "DB operations", one across an await — like a handler would.
    countQuery();
    await new Promise((resolve) => setTimeout(resolve, 1));
    countQuery();
    countQuery();
    return { id };
  }
}

describe('RequestTimingMiddleware', () => {
  it('records the route template and status of a real request', async () => {
    const perf = { record: jest.fn() };
    @Module({
      controllers: [ThingsController],
      providers: [
        RequestTimingMiddleware,
        { provide: PerfService, useValue: perf },
      ],
    })
    class TestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer.apply(RequestTimingMiddleware).forRoutes('{*path}');
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await request(app.getHttpServer()).get('/things/42?x=1').expect(200);
    await request(app.getHttpServer()).get('/nowhere').expect(404);
    await app.close();
    expect(perf.record).toHaveBeenCalledTimes(2);
    const [req, status, , queries] = perf.record.mock.calls[0];
    expect(routeTemplate(req)).toBe('/things/:id');
    expect(status).toBe(200);
    // Counted per request, across awaits (N+1 detector).
    expect(queries).toBe(3);
    expect(routeTemplate(perf.record.mock.calls[1][0])).toBe(
      '(не найден маршрут)',
    );
    expect(perf.record.mock.calls[1][1]).toBe(404);
  });
});
