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
  options: { offers?: Record<string, string>; slugs?: string[] } = {},
) {
  const offers = new Map(Object.entries(options.offers ?? {}));
  const slugs = new Set(options.slugs ?? []);
  const created: { slug: string }[] = [];
  const updated: { id: string }[] = [];

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
    },
    product: {
      create: jest.fn(({ data }: { data: { slug: string } }) => {
        if (slugs.has(data.slug))
          return Promise.reject(uniqueViolation(['slug']));
        slugs.add(data.slug);
        created.push({ slug: data.slug });
        return Promise.resolve({ id: `id-${data.slug}`, slug: data.slug });
      }),
      update: jest.fn(({ where }: { where: { id: string } }) => {
        updated.push({ id: where.id });
        return Promise.resolve({ id: where.id });
      }),
    },
  } as unknown as PrismaService;

  return {
    service: new ProductIdentityService(prisma),
    prisma,
    created,
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

    expect(updated).toEqual([{ id: 'product-7' }]);
    expect(created).toHaveLength(0);
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

describe('ProductIdentityService.upsertBrand', () => {
  it('returns the winner when two workers create the same brand at once', async () => {
    const prisma = {
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
