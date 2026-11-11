import { Logger } from '@nestjs/common';
import { emptySnapshot } from './connection/supplier-connection';
import {
  SupplierBlockedError,
  SupplierConnectionService,
} from './connection/supplier-connection.service';
import { SupplierInfo, SupplierQueueParser } from './supplier-queue-parser';

class TestParser extends SupplierQueueParser {
  protected readonly logger = new Logger('TestParser');
  protected readonly supplier: SupplierInfo = {
    code: 'dukon',
    name: 'Dukon',
    baseUrl: 'https://dukon.by',
  };
  parsed: string[] = [];
  parseProductUrl(url: string) {
    this.parsed.push(url);
    return Promise.reject(new Error('fetch failed'));
  }
  protected canonicalUrl(url: string) {
    return url;
  }
  protected isSkippedError() {
    return false;
  }
}

function build(usableAfter: (calls: number) => boolean) {
  const urls = Array.from({ length: 10 }, (_, i) => ({
    url: `https://dukon.by/p/${i}`,
  }));
  const queue = {
    updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    count: jest.fn(() => Promise.resolve(0)),
  };
  const prisma = {
    $queryRaw: jest.fn(() => Promise.resolve(urls)),
    sitemapsDukon: queue,
  };
  let routeCalls = 0;
  const connection = {
    assertUsable: jest.fn(() => Promise.resolve()),
    routeFor: jest.fn(() => {
      routeCalls++;
      return Promise.resolve({
        mode: 'auto',
        route: 'DIRECT',
        proxyConfigured: false,
        usable: usableAfter(routeCalls),
        snapshot: emptySnapshot(),
      });
    }),
    describeBlock: jest.fn(
      () =>
        'dukon.by напрямую не устанавливает соединение; прокси не настроен. Пачка не запускалась.',
    ),
  } as unknown as SupplierConnectionService;
  const parser = new TestParser(
    prisma as never,
    { addError: jest.fn(() => Promise.resolve()) } as never,
    {} as never,
    {} as never,
    { getRequestDelayMs: () => Promise.resolve(0) } as never,
    {} as never,
    connection,
  );
  return { parser, queue, connection };
}

describe('SupplierQueueParser batch and a blocked supplier', () => {
  it('is not started while the route is blocked', async () => {
    const { parser, connection } = build(() => true);
    (connection.assertUsable as jest.Mock).mockRejectedValue(
      new SupplierBlockedError('blocked', 'dukon'),
    );
    await expect(parser.processSitemapsBatch(10)).rejects.toBeInstanceOf(
      SupplierBlockedError,
    );
    expect(parser.parsed).toHaveLength(0);
  });

  it('stops when the ban starts mid-batch and hands the untouched rows back', async () => {
    // Blocked from the third URL on.
    const { parser, queue } = build((calls) => calls < 3);
    const run = parser.processSitemapsBatch(10);

    await expect(run).rejects.toBeInstanceOf(SupplierBlockedError);
    await expect(run).rejects.toThrow(
      /Пачка остановлена: разобрано 3, сохранено 0, не тронуто 7/,
    );
    expect(parser.parsed).toHaveLength(3);
    expect(queue.updateMany).toHaveBeenCalledWith({
      where: {
        url: {
          in: expect.arrayContaining(['https://dukon.by/p/9']) as string[],
        },
      },
      data: { lastTriedAt: null },
    });
  });

  it('runs the whole batch while the route stays usable', async () => {
    const { parser } = build(() => true);
    const result = await parser.processSitemapsBatch(10);
    expect(parser.parsed).toHaveLength(10);
    expect(result.batch).toMatchObject({ processed: 10, failed: 10 });
  });
});
