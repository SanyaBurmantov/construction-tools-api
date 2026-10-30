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

  it('keeps suffix variants separate and links every listing of the same model', async () => {
    const { brand, host, accessory } = await fixture();
    await create('Пылесос VX100D', 'VX100D');
    expect(
      (
        await service.get(accessory.slug, new RecommendationsQueryDto())
      ).fits.data.map((row) => row.id),
    ).toEqual([host.id]);
    // A markdown copy is the same model, not ambiguity.
    const markdown = await create('Пылесос VX100 уцененный', 'VX-100');
    await worker.refreshProduct(accessory, [brand]);
    expect(
      (
        await service.get(accessory.slug, new RecommendationsQueryDto())
      ).fits.data
        .map((row) => row.id)
        .sort(),
    ).toEqual([host.id, markdown.id].sort());
  });

  it('finds the tool by the model in its name, in either alphabet, and its kits', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    // Production: the tool's model column is empty, its sku is an internal
    // number — only the name says «AS 3001».
    const vacuum = await create(
      `Пылесос ${brand.name} AS 3001 + аксессуары 1400 Вт, 30 л`,
      '',
    );
    await prisma.product.update({
      where: { id: vacuum.id },
      data: { model: null, sku: '15030129' },
    });
    const kit = await create(
      `Аккум. дрель-шуруповерт ${brand.name} DF 333 DWYE в чем.`,
      '',
    );
    const trimmer = await create(
      `Триммер ${brand.name} ТЕ 4217-1 S в кор.`,
      '',
    );
    const bag = await create(
      `Мешок для пылесоса ${brand.name} AS 3001 сменный`,
      '',
    );
    const battery = await create(
      'Аккумулятор 12 В',
      '',
      `Подходит для ${brand.name} DF 333.`,
    );
    const knife = await create(
      `Нож для триммера ${brand.name} TE 4217-1 S`,
      '',
    );
    for (const row of [bag, battery, knife])
      await worker.refreshProduct(
        await prisma.product.findUniqueOrThrow({
          where: { id: row.id },
          select: RELATION_IDENTITY_SELECT,
        }),
        [brand],
      );
    const fitsOf = async (slug: string) =>
      (await service.get(slug, new RecommendationsQueryDto())).fits.data.map(
        (row) => row.id,
      );
    expect(await fitsOf(bag.slug)).toEqual([vacuum.id]);
    expect(await fitsOf(battery.slug)).toEqual([kit.id]);
    expect(await fitsOf(knife.slug)).toEqual([trimmer.id]);
    expect(
      (
        await service.get(vacuum.slug, new RecommendationsQueryDto())
      ).accessories.data.map((row) => row.id),
    ).toEqual([bag.id]);
  });

  it('sweeps the catalogue on its own, reading an AI-renamed accessory from its offer', async () => {
    const { brand, host } = await fixture();
    const renamed = await create('Фильтр тонкой очистки', '');
    await prisma.product.update({
      where: { id: renamed.id },
      data: { aiLockedFields: ['name'] },
    });
    const source = await prisma.source.create({
      data: { name: 'test', code: randomUUID(), url: 'https://example.test' },
    });
    await prisma.sourceProduct.create({
      data: {
        sourceId: source.id,
        externalId: renamed.id,
        url: `https://example.test/${renamed.id}`,
        name: `Фильтр для пылесоса ${brand.name} VX100`,
        specifications: {},
        productId: renamed.id,
      },
    });
    await prisma.siteSetting.deleteMany({
      where: { key: { startsWith: 'productRelations.cursor' } },
    });
    // Runs until the pass wraps around: no button, no manual step.
    for (let tick = 0; tick < 50 && (await worker.refresh()) >= 0; tick += 1) {
      const cursor = await prisma.siteSetting.findUnique({
        where: { key: 'productRelations.cursor.v2' },
      });
      if (cursor?.value === '') break;
    }
    expect(
      (
        await service.get(host.slug, new RecommendationsQueryDto())
      ).accessories.data
        .map((row) => row.id)
        .sort(),
    ).toContain(renamed.id);
    await prisma.sourceProduct.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
  });

  it('survives a DeepSeek rewrite of both sides within one worker tick', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    const source = await prisma.source.create({
      data: { name: 'test', code: randomUUID(), url: 'https://example.test' },
    });
    const tool = await create(`Триммер ${brand.name} UR 100 D в кор.`, '');
    const head = await create(
      'Головка триммерная полуавтоматическая',
      '',
      `Подходит для ${brand.name} UR 100 D.`,
    );
    await prisma.sourceProduct.create({
      data: {
        sourceId: source.id,
        externalId: head.id,
        url: `https://example.test/${head.id}`,
        name: head.name,
        description: head.descriptionFull,
        specifications: {},
        productId: head.id,
      },
    });
    // Other tests' products are "changed" too: start the queue from now.
    await prisma.siteSetting.deleteMany({
      where: { key: { startsWith: 'productRelations.changedSince' } },
    });
    // A fresh worker: the brand table is cached for an hour, and this test's
    // brand was created after an earlier test filled the cache.
    const ticker = new CompatibilityRefreshService(prisma);
    await ticker.refresh(); // first tick sets the change checkpoint
    await ticker.refreshProduct(
      await prisma.product.findUniqueOrThrow({
        where: { id: head.id },
        select: RELATION_IDENTITY_SELECT,
      }),
      [brand],
    );
    const accessoriesOf = async () =>
      (
        await service.get(tool.slug, new RecommendationsQueryDto())
      ).accessories.data.map((row) => row.id);
    expect(await accessoriesOf()).toEqual([head.id]);

    // What ai.service writes: new text, the field locked, contentUpdatedAt.
    await prisma.product.update({
      where: { id: head.id },
      data: {
        descriptionFull: 'Надёжная головка для скашивания травы.',
        aiLockedFields: ['descriptionFull'],
        contentUpdatedAt: new Date(),
      },
    });
    await prisma.product.update({
      where: { id: tool.id },
      data: {
        name: `Триммер аккумуляторный ${brand.name} UR100D`,
        aiLockedFields: ['name'],
        contentUpdatedAt: new Date(),
      },
    });
    expect(await accessoriesOf()).toEqual([]); // stale until rebuilt
    await ticker.refresh();
    expect(await accessoriesOf()).toEqual([head.id]);
    await prisma.sourceProduct.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
  });

  it('fills «Похожие» from the category when the kind is shared by few', async () => {
    const anchor = await create('Анкер клиновой М10х120 мм', '');
    const sibling = await create('Анкер рамный 10х112 мм', '');
    const neighbour = await create('Болт М10х120 мм', '');
    const similar = (
      await service.get(anchor.slug, new RecommendationsQueryDto())
    ).similar.map((row) => row.id);
    expect(similar[0]).toBe(sibling.id);
    expect(similar).toContain(neighbour.id);
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
