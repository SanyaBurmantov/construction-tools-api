import { Prisma } from '@prisma/client';
import { ProductIdentityService } from './product-identity.service';
import { PrismaService } from '../prisma/prisma.service';

const uniqueViolation = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });

/** In-memory stand-in for the two tables the service touches. */
function createService(
  options: {
    offers?: Record<string, string>;
    slugs?: string[];
    aiLocked?: Record<string, string[]>;
    locked?: Record<string, string[]>;
  } = {},
) {
  const offers = new Map(Object.entries(options.offers ?? {}));
  const slugs = new Set(options.slugs ?? []);
  const created: { slug: string }[] = [];
  const offerStubs: { sourceId: string; url: string; productId: string }[] = [];
  const createdData: Record<string, unknown>[] = [];
  const updated: { id: string; data?: Record<string, unknown> }[] = [];

  const prisma = {
    sourceProduct: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { sourceId_url: { sourceId: string; url: string } };
        }) => {
          const productId = offers.get(
            `${where.sourceId_url.sourceId}|${where.sourceId_url.url}`,
          );
          return Promise.resolve(productId ? { productId } : null);
        },
      ),
      upsert: jest.fn(
        ({
          create,
        }: {
          create: { sourceId: string; url: string; productId: string };
        }) => {
          offerStubs.push(create);
          return Promise.resolve({});
        },
      ),
    },
    // Array transactions: every operation was already started by the caller.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    product: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          aiLockedFields: options.aiLocked?.[where.id] ?? [],
          lockedFields: options.locked?.[where.id] ?? [],
        }),
      ),
      create: jest.fn(
        ({ data }: { data: { slug: string } & Record<string, unknown> }) => {
          if (slugs.has(data.slug))
            return Promise.reject(uniqueViolation(['slug']));
          slugs.add(data.slug);
          created.push({ slug: data.slug });
          createdData.push(data);
          return Promise.resolve({ id: `id-${data.slug}`, slug: data.slug });
        },
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          updated.push({ id: where.id, data });
          return Promise.resolve({ id: where.id });
        },
      ),
    },
  } as unknown as PrismaService;

  return {
    service: new ProductIdentityService(prisma),
    prisma,
    created,
    createdData,
    offerStubs,
    updated,
    slugs,
  };
}

const data = {
  update: { sku: 'X' },
  create: { name: 'Молоток', slug: 'ignored', priceCurrency: 'BYN' },
} as never;

describe('ProductIdentityService.save', () => {
  it('updates the product this supplier URL already belongs to', async () => {
    const { service, updated, created } = createService({
      offers: { 's1|https://x/1': 'product-7' },
    });

    await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: 'molotok',
      data,
    });

    expect(updated).toEqual([{ id: 'product-7', data: { sku: 'X' } }]);
    expect(created).toHaveLength(0);
  });

  it('leaves text an AI task rewrote alone on re-parse', async () => {
    const { service, updated } = createService({
      offers: { 's1|https://x/1': 'product-7' },
      aiLocked: { 'product-7': ['descriptionFull', 'seoTitle'] },
    });

    await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: 'molotok',
      data: {
        update: {
          name: 'Молоток',
          descriptionFull: 'Текст поставщика',
          seoTitle: 'Молоток купить в Минске',
        },
        create: { name: 'Молоток', slug: 'x', priceCurrency: 'BYN' },
      } as never,
    });

    expect(updated[0].data).toEqual({ name: 'Молоток' });
  });

  it('creates a new product when the offer is unknown', async () => {
    const { service, created } = createService();

    await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: 'molotok',
      data,
    });

    expect(created).toEqual([{ slug: 'molotok' }]);
  });

  it('gives a second product its own slug instead of overwriting the first', async () => {
    // This is the bug that lost products: two different items whose names
    // slugify identically used to collapse into one row via upsert-by-slug.
    const { service, created } = createService({ slugs: ['molotok'] });

    await service.save({
      sourceId: 's1',
      url: 'https://x/2',
      baseSlug: 'molotok',
      data,
    });

    expect(created).toEqual([{ slug: 'molotok-2' }]);
  });

  it('keeps trying suffixes when several are taken', async () => {
    const { service, created } = createService({
      slugs: ['molotok', 'molotok-2', 'molotok-3'],
    });

    await service.save({
      sourceId: 's1',
      url: 'https://x/4',
      baseSlug: 'molotok',
      data,
    });

    expect(created).toEqual([{ slug: 'molotok-4' }]);
  });

  it('survives losing a race to a concurrent worker', async () => {
    // Same symptom as a taken slug — P2002 on create — so the retry covers the
    // "Unique constraint failed on the fields: (slug)" errors from the log.
    const { service, created } = createService({ slugs: ['drel'] });

    await service.save({
      sourceId: 's1',
      url: 'https://x/9',
      baseSlug: 'drel',
      data,
    });

    expect(created).toEqual([{ slug: 'drel-2' }]);
  });

  it('falls back to a generic slug rather than throwing on an empty one', async () => {
    const { service, created } = createService();

    await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: '',
      data,
    });

    expect(created).toEqual([{ slug: 'product' }]);
  });
});

describe('ProductIdentityService parser invariants', () => {
  // The product and the link from its supplier URL commit together, so a
  // failure later in the parse cannot leave an orphan for the retry to
  // duplicate as `slug-2`.
  it('creates the offer link in the same transaction as the product', async () => {
    const { service, offerStubs } = createService();

    const product = await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: 'molotok',
      data,
    });

    expect(offerStubs).toEqual([
      expect.objectContaining({
        sourceId: 's1',
        url: 'https://x/1',
        productId: expect.any(String),
      }),
    ]);
    expect(product).toMatchObject({ slug: 'molotok' });
  });

  it('never lets a parser write prices or status', async () => {
    const { service, createdData, updated } = createService({
      offers: { 's1|https://x/2': 'product-2' },
    });

    await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: 'molotok',
      data: {
        update: {},
        create: {
          name: 'Молоток',
          slug: 'x',
          priceValue: 10,
          oldPrice: 20,
          status: 'PUBLISHED',
        },
      } as never,
    });
    await service.save({
      sourceId: 's1',
      url: 'https://x/2',
      baseSlug: 'molotok',
      data: {
        update: { name: 'Молоток', priceValue: 10, status: 'PUBLISHED' },
        create: { name: 'Молоток', slug: 'x' },
      } as never,
    });

    // New products wait in DRAFT until priced; the update drops both.
    expect(createdData[0]).toMatchObject({
      status: 'DRAFT',
      statusSource: 'SYSTEM',
    });
    expect(createdData[0]).not.toHaveProperty('priceValue');
    expect(createdData[0]).not.toHaveProperty('oldPrice');
    expect(updated[0].data).toEqual({ name: 'Молоток' });
  });

  it('leaves fields an admin corrected alone on re-parse', async () => {
    const { service, updated } = createService({
      offers: { 's1|https://x/1': 'product-7' },
      locked: { 'product-7': ['name', 'categoryId'] },
    });

    await service.save({
      sourceId: 's1',
      url: 'https://x/1',
      baseSlug: 'molotok',
      data: {
        update: { name: 'Имя поставщика', categoryId: 'c1', sku: 'S' },
        create: { name: 'x', slug: 'x' },
      } as never,
    });

    expect(updated[0].data).toEqual({ sku: 'S' });
  });
});

describe('ProductIdentityService.upsertBrand', () => {
  it('returns the winner when two workers create the same brand at once', async () => {
    const prisma = {
      brandAlias: { findUnique: jest.fn(() => Promise.resolve(null)) },
      brand: {
        upsert: jest.fn(() => Promise.reject(uniqueViolation(['slug']))),
        findUnique: jest.fn(() => Promise.resolve({ id: 'brand-1' })),
      },
    } as unknown as PrismaService;

    await expect(
      new ProductIdentityService(prisma).upsertBrand('Makita'),
    ).resolves.toBe('brand-1');
  });

  it('ignores a name that slugifies to nothing', async () => {
    const { service } = createService();

    await expect(service.upsertBrand('!!!')).resolves.toBeUndefined();
  });
});

describe('ProductIdentityService brand aliases', () => {
  // An admin merged «Makita Corp» into «Makita»: the supplier's spelling must
  // not resurrect the merged-away brand.
  it('resolves a merged brand to the survivor', async () => {
    const upsert = jest.fn();
    const prisma = {
      brandAlias: {
        findUnique: jest.fn(() => Promise.resolve({ brandId: 'makita' })),
      },
      brand: { upsert },
    } as unknown as PrismaService;

    await expect(
      new ProductIdentityService(prisma).upsertBrand('Makita Corp'),
    ).resolves.toBe('makita');
    expect(upsert).not.toHaveBeenCalled();
  });
});
