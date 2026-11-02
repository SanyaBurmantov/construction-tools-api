import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OfferSplitService } from './offer-split.service';
import type { OffersService } from './offers.service';

/**
 * Opt-in: `OFFER_SPLIT_TEST_DATABASE_URL` pointing at a migrated database
 * whose name ends in `_test`.
 */
const testUrl = process.env.OFFER_SPLIT_TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run('OfferSplitService (PostgreSQL)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!new URL(testUrl!).pathname.endsWith('_test')) {
      throw new Error('Use an isolated database whose name ends in _test');
    }
    prisma = new PrismaService({ datasources: { db: { url: testUrl } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('gives each other article its own draft product and queues every URL', async () => {
    const key = randomUUID().slice(0, 8);
    const category = await prisma.category.create({
      data: {
        name: `Компрессоры ${key}`,
        slug: `c-${key}`,
        pathKey: `c-${key}`,
        level: 0,
        path: [],
        seoTitle: '',
        seoDescription: '',
      },
    });
    const source = await prisma.source.upsert({
      where: { code: 'th-tools' },
      update: {},
      create: {
        name: 'th-tool.by',
        code: 'th-tools',
        url: 'https://th-tool.by',
      },
    });
    const card = await prisma.product.create({
      data: {
        name: 'Пистолет для подкачки шин',
        slug: `pistolet-${key}`,
        categoryId: category.id,
        priceValue: 10,
      },
    });
    const urls = ['F', 'RF', 'RF2', 'PA'].map(
      (code) => `https://th-tool.by/pistolet-${key}-${code}/`,
    );
    const skus = ['F-STG-32', 'RF-STG-32', 'RF STG 32', 'PA-STG-32'];
    for (const [i, url] of urls.entries()) {
      await prisma.sourceProduct.create({
        data: {
          id: `${key}-${i}`,
          sourceId: source.id,
          url,
          externalId: url,
          name: 'Пистолет для подкачки шин',
          sku: skus[i],
          price: 10 + i,
          specifications: {},
          productId: card.id,
        },
      });
    }
    await prisma.sitemapsThTools.create({
      data: { url: urls[0], status: 'DONE', visitedAt: new Date() },
    });
    const recompute = jest.fn(() => Promise.resolve(null));
    const service = new OfferSplitService(prisma, {
      recomputeFromOffers: recompute,
    } as unknown as OffersService);

    expect(await service.splitProduct(card.id)).toBe(2);

    const offers = await prisma.sourceProduct.findMany({
      where: { url: { in: urls } },
      select: { url: true, productId: true },
      orderBy: { url: 'asc' },
    });
    const byUrl = new Map(offers.map((o) => [o.url, o.productId]));
    expect(byUrl.get(urls[0])).toBe(card.id);
    expect(byUrl.get(urls[1])).toBe(byUrl.get(urls[2]));
    expect(byUrl.get(urls[1])).not.toBe(card.id);
    expect(byUrl.get(urls[3])).not.toBe(card.id);
    const created = await prisma.product.findMany({
      where: { id: { in: [byUrl.get(urls[1])!, byUrl.get(urls[3])!] } },
    });
    expect(created.map((p) => p.status)).toEqual(['DRAFT', 'DRAFT']);
    expect(created.every((p) => p.categoryId === category.id)).toBe(true);
    const queued = await prisma.sitemapsThTools.findMany({
      where: { url: { in: urls } },
    });
    expect(queued).toHaveLength(4);
    expect(queued.every((q) => q.status === 'PENDING' && !q.visitedAt)).toBe(
      true,
    );
    expect(recompute).toHaveBeenCalledWith(card.id);
    // Idempotent: nothing left to take apart.
    expect(await service.splitProduct(card.id)).toBe(0);

    await prisma.sitemapsThTools.deleteMany({ where: { url: { in: urls } } });
    await prisma.sourceProduct.deleteMany({ where: { url: { in: urls } } });
    await prisma.product.deleteMany({ where: { categoryId: category.id } });
    await prisma.category.delete({ where: { id: category.id } });
  });
});
