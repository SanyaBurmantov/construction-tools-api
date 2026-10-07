import { CategoryQueueService } from './category-queue.service';

type Access = {
  crawlCategory: (url: string) => Promise<{ pagesCrawled: number }>;
  fetchText: (url: string) => Promise<string>;
};

describe('TH-Tools category crawl settings', () => {
  it('uses the current admin request delay and page limit', async () => {
    const settings = {
      getMaxPages: jest.fn(() => Promise.resolve(1)),
      getRequestDelayMs: jest.fn(() => Promise.resolve(0)),
    };
    const prisma = { sitemapsThTools: { count: () => Promise.resolve(0) } };
    const service = new CategoryQueueService(
      prisma as never,
      { saveSitemaps: () => Promise.resolve() } as never,
      {} as never,
      settings as never,
    ) as unknown as Access;
    const fetch = jest
      .spyOn(service, 'fetchText')
      .mockResolvedValue(
        '<a href="/actual-product/">Товар</a><a href="?page=3">3</a>',
      );
    const result = await service.crawlCategory(
      'https://th-tool.by/category/ruchnoy-instrument/',
    );
    expect(result.pagesCrawled).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settings.getMaxPages).toHaveBeenCalledWith('th-tools');
    expect(settings.getRequestDelayMs).toHaveBeenCalledWith('th-tools');
  });
});
