import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductService } from '../products.service';
import { buildMatchKeys } from '../../offers/product-matching';
import { CompatibilityRefreshService } from './compatibility-refresh.service';
import {
  CartRecommendationsController,
  RecommendationsController,
} from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsQueryDto } from './recommendations.dto';
import { RELATION_IDENTITY_SELECT } from './relation-select';

const testUrl = process.env.PRODUCT_RELATIONS_TEST_DATABASE_URL;
// The tests change data and read it back at once.
process.env.RECOMMENDATIONS_CACHE_MS = '0';
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
      controllers: [RecommendationsController, CartRecommendationsController],
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

  it('lists consumables by standard across brands, pages a group, and fills the cart', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    const otherBrand = await prisma.brand.create({
      data: {
        name: `Volat${randomUUID().slice(0, 6)}`,
        slug: randomUUID(),
        seoTitle: '',
        seoDescription: '',
      },
    });
    const grinder = await create(
      `Одноручная углошлифмашина ${brand.name} AG 1209 в кор. 900 Вт, 125 мм`,
      '',
    );
    const discs = [];
    for (let i = 0; i < 5; i += 1)
      discs.push(
        await create(`Круг отрезной 125х1.${i}x22.2 мм для металла №${i}`, ''),
      );
    // Another make — a standard is not a brand.
    await prisma.product.update({
      where: { id: discs[4].id },
      data: { brandId: otherBrand.id },
    });
    const wrong = await create('Круг отрезной 180х1.6x22.2 мм для металла', '');
    await worker.refreshFitments([
      grinder.id,
      wrong.id,
      ...discs.map((d) => d.id),
    ]);

    const page = await service.get(grinder.slug, new RecommendationsQueryDto());
    expect(page.consumables).toHaveLength(1);
    expect(page.consumables[0]).toMatchObject({
      key: 'disc:125',
      title: 'Круги и диски 125 мм',
      pagination: { total: 5, pages: 2 },
    });
    expect(page.consumables[0].data[0]).not.toHaveProperty('costPrice');
    const second = await service.group(grinder.slug, 'disc:125', 'PART', 2);
    expect(second.data).toHaveLength(1);
    expect(
      new Set([...page.consumables[0].data, ...second.data].map((d) => d.id)),
    ).toEqual(new Set(discs.map((d) => d.id)));
    expect(
      (
        await service.get(discs[4].slug, new RecommendationsQueryDto())
      ).compatibleTools[0].data.map((row) => row.id),
    ).toEqual([grinder.id]);
    // Only a group the product has.
    await expect(
      service.group(grinder.slug, 'disc:180', 'PART', 1),
    ).rejects.toThrow('Подборка не найдена');
    expect(
      (
        await fetch(
          `${origin}/products/${grinder.slug}/recommendations/group?key=disc:125&role=PART&page=2`,
        )
      ).status,
    ).toBe(200);

    const cart = await service.forCart([grinder.id, discs[0].id]);
    expect(cart.data.map((row) => row.product.id)).not.toContain(discs[0].id);
    expect(cart.data[0].reason).toBe('Круги и диски 125 мм');
    expect(cart.data.length).toBe(3); // three per standard
    await prisma.product.updateMany({
      where: { brandId: otherBrand.id },
      data: { brandId },
    });
    await prisma.brand.delete({ where: { id: otherBrand.id } });
  });

  it('compares packs of the same item per piece', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    const small = await create(
      `Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) ${brand.name}`,
      '',
    );
    const box = await create(
      `Анкер забиваемый М10х12х40 мм (100 шт в карт. уп.) ${brand.name}`,
      '',
    );
    await prisma.product.update({
      where: { id: small.id },
      data: { priceValue: 2 },
    });
    await prisma.product.update({
      where: { id: box.id },
      data: { priceValue: 30 },
    });
    await worker.refreshFitments([small.id, box.id]);
    const packs = (await service.get(small.slug, new RecommendationsQueryDto()))
      .packs;
    expect(
      packs.map((pack) => [pack.quantity, pack.unitPrice, pack.current]),
    ).toEqual([
      [4, 0.5, true],
      [100, 0.3, false],
    ]);
  });

  it('switches between sizes of one line and pairs bolts with nuts of their material', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: brandId },
    });
    const drills = [];
    for (const size of ['8.0х75х117', '6.0х57х93', '10.0х87х133'])
      drills.push(
        await create(
          `Сверло по металлу ц/х ${size} мм HSS-Co ${brand.name}`,
          '',
        ),
      );
    const bolt = await create(
      `Болт М10х80 мм шестигр., нерж.сталь (А2), DIN 933 ${brand.name}`,
      '',
    );
    const zincNut = await create(
      `Гайка М10 шестигр., цинк, DIN 934 ${brand.name}`,
      '',
    );
    const steelNut = await create(
      `Гайка М10 шестигр., нерж.сталь (А2), DIN 934 ${brand.name}`,
      '',
    );
    await worker.refreshFitments([
      ...drills.map((d) => d.id),
      bolt.id,
      zincNut.id,
      steelNut.id,
    ]);
    const variants = (
      await service.get(drills[1].slug, new RecommendationsQueryDto())
    ).variants;
    expect(variants.map((v) => [v.label, v.current])).toEqual([
      ['6.0х57х93 мм', true],
      ['8.0х75х117 мм', false],
      ['10.0х87х133 мм', false],
    ]);
    // AI rewrote one drill's name: it stays in the line by the supplier's name.
    const source = await prisma.source.create({
      data: { name: 'test', code: randomUUID(), url: 'https://example.test' },
    });
    await prisma.sourceProduct.create({
      data: {
        sourceId: source.id,
        externalId: drills[0].id,
        url: `https://example.test/${drills[0].id}`,
        name: drills[0].name,
        specifications: {},
        productId: drills[0].id,
      },
    });
    await prisma.product.update({
      where: { id: drills[0].id },
      data: {
        name: `Сверло по металлу с цилиндрическим хвостовиком 8.0х75х117 мм HSS-Co ${brand.name}`,
        aiLockedFields: ['name'],
      },
    });
    await worker.refreshFitments([drills[0].id]);
    expect(
      (await service.get(drills[1].slug, new RecommendationsQueryDto()))
        .variants,
    ).toHaveLength(3);
    await prisma.sourceProduct.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
    // A size that is gone is gone from the switch.
    await prisma.product.update({
      where: { id: drills[2].id },
      data: { status: 'HIDDEN' },
    });
    expect(
      (await service.get(drills[1].slug, new RecommendationsQueryDto()))
        .variants,
    ).toHaveLength(2);
    const nuts = (await service.get(bolt.slug, new RecommendationsQueryDto()))
      .consumables[0];
    expect(nuts.title).toBe('Гайки и шайбы М10');
    expect(nuts.data.map((row) => row.id)).toEqual([steelNut.id, zincNut.id]);
    // Keys keep their case through the validation pipe.
    expect(
      (
        await fetch(
          `${origin}/products/${bolt.slug}/recommendations/group?key=thread:M10&role=PART&page=1`,
        )
      ).status,
    ).toBe(200);
  });

  it('serves cart suggestions over HTTP and validates the ids', async () => {
    const { host } = await fixture();
    expect(
      (await fetch(`${origin}/recommendations/cart?ids=${host.id}`)).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/recommendations/cart?ids=not-an-id`)).status,
    ).toBe(400);
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
