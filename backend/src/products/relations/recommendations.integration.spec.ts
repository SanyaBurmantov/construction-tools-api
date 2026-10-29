import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductService } from '../products.service';
import { buildMatchKeys } from '../../offers/product-matching';
import { CompatibilityRefreshService } from './compatibility-refresh.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsQueryDto } from './recommendations.dto';
import { RELATION_IDENTITY_SELECT } from './relation-select';

const testUrl = process.env.PRODUCT_RELATIONS_TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

/** Opt-in only: migrations must be applied to an isolated test database. */
integration('product recommendations (PostgreSQL)', () => {
  let prisma: PrismaService;
  let service: RecommendationsService;
  let worker: CompatibilityRefreshService;
  let app: INestApplication;
  let origin: string;
  let categoryId: string;
  let brandId: string;

  beforeAll(async () => {
    if (!new URL(testUrl!).pathname.startsWith('/product_relations_test')) {
      throw new Error('Use an isolated database named product_relations_test*');
    }
    prisma = new PrismaService({ datasources: { db: { url: testUrl } } });
    await prisma.$connect();
    service = new RecommendationsService(prisma);
    worker = new CompatibilityRefreshService(prisma);
    const module = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [{ provide: RecommendationsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  beforeEach(async () => {
    const key = randomUUID();
    const category = await prisma.category.create({
      data: {
        name: 'Пылесосы и аксессуары',
        slug: key,
        pathKey: key,
        level: 0,
        path: [],
        seoTitle: '',
        seoDescription: '',
      },
    });
    const brand = await prisma.brand.create({
      data: {
        name: `Maker${key.slice(0, 8)}`,
        slug: key,
        seoTitle: '',
        seoDescription: '',
      },
    });
    categoryId = category.id;
    brandId = brand.id;
  });

  afterEach(async () => {
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.brand.delete({ where: { id: brandId } });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function create(
    name: string,
    model: string,
    descriptionFull: string | null = null,
  ) {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    return prisma.product.create({
      data: {
        name,
        model,
        descriptionFull,
        brandId,
        categoryId,
        slug: randomUUID(),
        priceValue: 100,
        priceCurrency: 'BYN',
        costPrice: 10,
        stockStatus: 'in_stock',
        ...buildMatchKeys({ id: '', name, model, brandName: brand.name }),
      },
    });
  }

  async function fixture() {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    const host = await create('Пылесос VX100', 'VX100');
    const accessory = await create(
      'Фильтр 😺 F100',
      'F100',
      `Подходит для ${brand.name} VX100.`,
    );
    await worker.refreshProduct(accessory, [brand]);
    return { brand, host, accessory };
  }

  it('reads a single stored relation in both directions and exposes compact cards over HTTP', async () => {
    const { host, accessory } = await fixture();
    expect(
      await prisma.productCompatibility.count({
        where: { accessoryId: accessory.id },
      }),
    ).toBe(1);
    const hostResponse = await fetch(
      `${origin}/products/${host.slug}/recommendations`,
    );
    expect(hostResponse.status).toBe(200);
    const hostBody = (await hostResponse.json()) as {
      accessories: { data: Array<Record<string, unknown>> };
    };
    expect(hostBody.accessories.data.map((row) => row.id)).toEqual([
      accessory.id,
    ]);
    for (const field of [
      'costPrice',
      'descriptionFull',
      'productSpecs',
      'accessorySignature',
      'modelCode',
      'aiLockedFields',
      'fitsProducts',
      'compatibleAccessories',
    ]) {
      expect(hostBody.accessories.data[0]).not.toHaveProperty(field);
    }
    const result = await service.get(
      accessory.slug,
      new RecommendationsQueryDto(),
    );
    expect(result.fits.data.map((row) => row.id)).toEqual([host.id]);
  });

  it('keeps suffix variants separate and rejects ambiguity even before the next sweep', async () => {
    const { brand, host, accessory } = await fixture();
    await create('Пылесос VX100D', 'VX100D');
    expect(
      (
        await service.get(accessory.slug, new RecommendationsQueryDto())
      ).fits.data.map((row) => row.id),
    ).toEqual([host.id]);
    const duplicate = await create('Пылесос VX100 другой', 'VX-100');
    expect(
      (await service.get(accessory.slug, new RecommendationsQueryDto())).fits
        .data,
    ).toEqual([]);
    await worker.refreshProduct(accessory, [brand]);
    expect(
      await prisma.productCompatibility.count({
        where: { accessoryId: accessory.id },
      }),
    ).toBe(0);
    await prisma.product.delete({ where: { id: duplicate.id } });
  });

  it('hides changed source evidence immediately and rebuilds the reverse link', async () => {
    const { brand, host, accessory } = await fixture();
    const next = await create('Пылесос VX100D', 'VX100D');
    const changed = await prisma.product.update({
      where: { id: accessory.id },
      data: {
        descriptionFull: `Подходит для ${brand.name} VX100D.`,
      },
    });
    expect(
      (await service.get(host.slug, new RecommendationsQueryDto())).accessories
        .data,
    ).toEqual([]);
    expect(
      (await service.get(accessory.slug, new RecommendationsQueryDto())).fits
        .data,
    ).toEqual([]);
    await worker.refreshProduct(changed, [brand]);
    expect(
      (
        await service.get(accessory.slug, new RecommendationsQueryDto())
      ).fits.data.map((row) => row.id),
    ).toEqual([next.id]);
  });

  it('hides changed target identity and AI-locked evidence without waiting for refresh', async () => {
    const { host, accessory } = await fixture();
    await prisma.product.update({
      where: { id: host.id },
      data: { model: 'VX200' },
    });
    expect(
      (await service.get(accessory.slug, new RecommendationsQueryDto())).fits
        .data,
    ).toEqual([]);
    await prisma.product.update({
      where: { id: host.id },
      data: { model: 'VX100' },
    });
    await prisma.product.update({
      where: { id: accessory.id },
      data: { aiLockedFields: ['descriptionFull'] },
    });
    expect(
      (await service.get(host.slug, new RecommendationsQueryDto())).accessories
        .data,
    ).toEqual([]);
  });

  it('serves current prices, hides unpublished products, and cascades deleted endpoints', async () => {
    const { host, accessory } = await fixture();
    await prisma.product.update({
      where: { id: accessory.id },
      data: { priceValue: 150 },
    });
    expect(
      (await service.get(host.slug, new RecommendationsQueryDto())).accessories
        .data[0].priceValue,
    ).toBe(150);
    await prisma.product.update({
      where: { id: accessory.id },
      data: { status: 'HIDDEN' },
    });
    expect(
      (await service.get(host.slug, new RecommendationsQueryDto())).accessories
        .data,
    ).toEqual([]);
    await prisma.product.delete({ where: { id: host.id } });
    expect(
      await prisma.productCompatibility.count({
        where: { accessoryId: accessory.id },
      }),
    ).toBe(0);
  });

  it('paginates reverse links and bounds invalid page parameters', async () => {
    const { brand, accessory } = await fixture();
    for (let i = 0; i < 5; i += 1)
      await create(`Пылесос VX${200 + i}`, `VX${200 + i}`);
    const updated = await prisma.product.update({
      where: { id: accessory.id },
      data: {
        descriptionFull: `Подходит для ${brand.name} VX100, VX200, VX201, VX202, VX203, VX204.`,
      },
    });
    await worker.refreshProduct(updated, [brand]);
    const first = await service.get(
      accessory.slug,
      new RecommendationsQueryDto(),
    );
    const second = await service.get(accessory.slug, {
      accessoriesPage: 1,
      fitsPage: 2,
    });
    expect(first.fits.pagination).toEqual({
      page: 1,
      pages: 2,
      total: 6,
      limit: 4,
    });
    expect(first.fits.data).toHaveLength(4);
    expect(second.fits.data).toHaveLength(2);
    expect(
      new Set([...first.fits.data, ...second.fits.data].map((row) => row.id))
        .size,
    ).toBe(6);
    expect(
      (
        await fetch(
          `${origin}/products/${accessory.slug}/recommendations?fitsPage=-1`,
        )
      ).status,
    ).toBe(400);
    expect(
      (await fetch(`${origin}/products/unknown/recommendations`)).status,
    ).toBe(404);
  });

  it('leaves normal listing and detail payloads free of relation data', async () => {
    const { host } = await fixture();
    const products = new ProductService(prisma);
    const listing = await products.findAllFiltered({ categoryId });
    const detail = await products.getProductBySlug(host.slug);
    for (const row of [...listing.data, detail]) {
      expect(row).not.toHaveProperty('compatibleAccessories');
      expect(row).not.toHaveProperty('fitsProducts');
      expect(row).not.toHaveProperty('modelCode');
      expect(row).not.toHaveProperty('costPrice');
    }
  });

  it('invalidates a merged-away endpoint and can rebuild from the survivor', async () => {
    const { brand, host, accessory } = await fixture();
    // A merge deletes the duplicate endpoint; the FK cannot leave ghost links.
    await prisma.product.delete({ where: { id: host.id } });
    const survivor = await create('Пылесос VX100', 'VX100');
    expect(
      (await service.get(accessory.slug, new RecommendationsQueryDto())).fits
        .data,
    ).toEqual([]);
    const current = await prisma.product.findUniqueOrThrow({
      where: { id: accessory.id },
      select: RELATION_IDENTITY_SELECT,
    });
    await worker.refreshProduct(current, [brand]);
    expect(
      (
        await service.get(accessory.slug, new RecommendationsQueryDto())
      ).fits.data.map((row) => row.id),
    ).toEqual([survivor.id]);
  });
});
