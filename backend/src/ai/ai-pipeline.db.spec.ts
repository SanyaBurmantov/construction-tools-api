/**
 * The AI pipeline end to end against a real Postgres: templates, checks,
 * the second opinion, the URL move with its 301, IndexNow, the revert, and
 * what the next re-parse does to the card. A fake model; no network.
 *
 * Skipped unless AI_PIPELINE_TEST_DATABASE_URL points at a throwaway
 * database whose name ends in `_test` — the test TRUNCATES the catalogue.
 *
 *   createdb ai_pipeline_test
 *   DATABASE_URL=postgresql://…/ai_pipeline_test npx prisma migrate deploy
 *   AI_PIPELINE_TEST_DATABASE_URL=postgresql://…/ai_pipeline_test \
 *     npx jest src/ai/ai-pipeline.db.spec.ts --runInBand
 */
import { PrismaClient } from '@prisma/client';
import { FALLBACK_CATEGORY_SLUG } from '../common/constants/catalog';
import { ProductIdentityService } from '../parser/product-identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { IndexNowService } from '../seo/indexnow.service';
import { AiService } from './ai.service';

const url = process.env.AI_PIPELINE_TEST_DATABASE_URL ?? '';
const safe = /\/[^/?]+_test(\?|$)/.test(url);
const describeDb = safe ? describe : describe.skip;

const PRODUCT_FIELDS = [
  'name',
  'descriptionShort',
  'descriptionFull',
  'seoTitle',
  'seoDescription',
];
const OLD_BOSCH_SLUG = 'akkum-perforator-bosch-gbh-18v-45-c-v-chem-611913120';

describeDb('AI pipeline on a real database', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url } },
  }) as unknown as PrismaService;
  const env = { ...process.env };
  const answers: Record<string, Record<string, string>> = {};
  const objections: Record<string, Record<string, string>> = {};
  const client = {
    enabled: true,
    providerLabel: 'DeepSeek',
    defaultModel: 'deepseek-flash',
    allowsModel: (model: string) => model.startsWith('deepseek-'),
    chat: jest.fn((_model: string, messages: Array<{ content: string }>) => {
      const user = messages[1].content;
      const items = (
        JSON.parse(user.slice(user.indexOf('{'))) as {
          items: Array<{ id: string; proposed?: Record<string, string> }>;
        }
      ).items;
      const usage = {
        promptTokens: 1000,
        completionTokens: 300,
        cacheHitTokens: 600,
      };
      const verifying = messages[0].content.includes('проверяющий редактор');
      const content = JSON.stringify({
        items: items.map((item) =>
          verifying
            ? {
                id: item.id,
                fields: Object.fromEntries(
                  Object.keys(item.proposed ?? {}).map((field) => {
                    const problem = objections[item.id]?.[field];
                    return [
                      field,
                      problem ? { ok: false, problem } : { ok: true },
                    ];
                  }),
                ),
              }
            : { id: item.id, ...answers[item.id] },
        ),
      });
      return Promise.resolve({ content, model: 'deepseek-flash', usage });
    }),
  };
  let ai: AiService;
  let identity: ProductIdentityService;
  const ids: Record<string, string> = {};

  async function runTasks() {
    for (let i = 0; i < 20; i++) {
      const task = await ai.nextRunnableTask();
      if (!task) return;
      await ai.runBatch(task);
    }
  }

  beforeAll(async () => {
    process.env.INDEXNOW_KEY = 'testkey12345678';
    process.env.PUBLIC_ORIGIN = 'https://gost.by';
    delete process.env.AI_VERIFY;
    await prisma.$executeRawUnsafe(
      'TRUNCATE "IndexNowUrl","AiTaskItem","AiTask","ProductRedirect","ProductSpecification","Specification","SourceProduct","Product","Brand","Category","Source" CASCADE',
    );
    const source = (code: string, name: string) =>
      prisma.source.create({ data: { code, name, url: `https://${code}` } });
    const category = (
      name: string,
      slug: string,
      parentId: string | null = null,
    ) =>
      prisma.category.create({
        data: {
          name,
          slug,
          pathKey: slug,
          level: parentId ? 1 : 0,
          parentId,
          seoTitle: name,
          seoDescription: name,
        },
      });
    const brand = (name: string) =>
      prisma.brand.create({
        data: {
          name,
          slug: name.toLowerCase(),
          seoTitle: name,
          seoDescription: name,
        } as never,
      });
    const tools = await source('tools-by', 'Tools.by');
    const th = await source('th-tools', 'th-tool.by');
    const root = await category('Электроинструмент', 'elektroinstrument');
    const perf = await category(
      'Аккумуляторные перфораторы',
      'akkumulyatornye-perforatory',
      root.id,
    );
    const thPerf = await category(
      'Перфораторы (th)',
      'perforatory-th',
      root.id,
    );
    await category('Неразобранные', FALLBACK_CATEGORY_SLUG);
    const anchors = await category('Анкер забиваемый', 'anker-zabivaemyi');
    const bosch = await brand('Bosch');
    const starfix = await brand('STARFIX');
    Object.assign(ids, {
      tools: tools.id,
      th: th.id,
      perf: perf.id,
      thPerf: thPerf.id,
    });

    const product = async (
      data: Record<string, unknown>,
      specs: Record<string, string>,
      offerUrl: string,
    ) => {
      const row = await prisma.product.create({
        data: { status: 'PUBLISHED', priceValue: 10, ...data } as never,
      });
      for (const [name, value] of Object.entries(specs)) {
        const spec = await prisma.specification.upsert({
          where: { categoryId_key: { categoryId: row.categoryId, key: name } },
          update: {},
          create: { name, key: name, categoryId: row.categoryId },
        });
        await prisma.productSpecification.create({
          data: { productId: row.id, specificationId: spec.id, value },
        });
      }
      await prisma.sourceProduct.create({
        data: {
          sourceId: tools.id,
          url: offerUrl,
          externalId: offerUrl,
          name: String(data.name),
          productId: row.id,
          price: 5,
          specifications: {},
        } as never,
      });
      return row.id;
    };
    ids.bosch = await product(
      {
        name: 'Аккум. перфоратор BOSCH GBH 18V-45 C в чем.',
        slug: OLD_BOSCH_SLUG,
        sku: '611913120',
        categoryId: perf.id,
        brandId: bosch.id,
        descriptionFull:
          'Особенности: Bluetooth Low Energy. BITURBO. Контроль отдачи. Комплектация: + Перфоратор + Боковая рукоятка + Кейс.',
      },
      {
        Патрон: 'SDS-Max',
        'Напряжение, В': '18',
        'Энергия удара, Дж': '12.5',
        'Диаметр сверления в бетоне, мм': '45',
      },
      'https://tools.by/product/1',
    );
    const anchorSpecs = {
      Материал: 'Сталь',
      Покрытие: 'Цинк',
      'Длина, мм': '40',
    };
    ids.a4 = await product(
      {
        name: 'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
        slug: 'anker-4',
        categoryId: anchors.id,
        brandId: starfix.id,
      },
      anchorSpecs,
      'https://tools.by/product/2',
    );
    ids.a50 = await product(
      {
        name: 'Анкер забиваемый М10х12х40 мм (50 шт в карт. уп.) STARFIX',
        slug: 'anker-50',
        categoryId: anchors.id,
        brandId: starfix.id,
      },
      anchorSpecs,
      'https://tools.by/product/3',
    );

    const variant =
      'Анкер забиваемый из стали с цинковым покрытием для крепления к бетону. Подходит для монтажа подвесных конструкций, кабельных трасс и вентиляции на строительных объектах и производствах.';
    answers[ids.bosch] = {
      name: 'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max, 18 В, 12,5 Дж, в кейсе',
      descriptionShort:
        'Аккумуляторный перфоратор SDS-Max с двигателем BITURBO и энергией удара 12,5 Дж для работ по бетону.',
      descriptionFull:
        'Инструмент оснащен системой контроля отдачи KickBack Control. Перфоратор предназначен для сверления бетона, диаметр сверления до 45 мм, энергия удара 12,5 Дж, напряжение 18 В. В комплекте кейс и боковая рукоятка.',
      seoTitle: 'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max',
      seoDescription:
        'Аккумуляторный перфоратор Bosch GBH 18V-45 C SDS-Max, 18 В, 12,5 Дж. Доставка по Беларуси, оплата по безналу для организаций.',
    };
    answers[ids.a4] = {
      // Latin M and x, as a model writes them; the supplier typed Cyrillic.
      name: 'Анкер забиваемый STARFIX M10x12x40 мм, 4 шт. в зип-пакете',
      descriptionShort:
        'Анкер забиваемый M10x12x40 мм из стали с цинковым покрытием, 4 шт. в упаковке.',
      descriptionFull: variant,
      seoTitle: 'Анкер забиваемый М10х12х40 мм STARFIX, 4 шт.',
      seoDescription:
        'Анкер забиваемый М10х12х40 мм STARFIX, сталь, цинк, 4 шт. Доставка по Беларуси.',
    };
    answers[ids.a50] = {
      name: 'Анкер забиваемый STARFIX М10х12х40 мм, 50 шт. в пакете',
      descriptionShort:
        'Анкер забиваемый М10х12х40 мм из стали с цинковым покрытием, 50 шт. в упаковке.',
      descriptionFull: variant,
      seoTitle: 'Анкер забиваемый М10х12х40 мм STARFIX, 50 шт.',
      seoDescription:
        'Анкер забиваемый М10х12х40 мм STARFIX, сталь, цинк, 50 шт. Доставка по Беларуси, оплата по безналу для организаций.',
    };
    objections[ids.a50] = {
      name: 'в данных фасовка 50 шт в картонной коробке, а не в пакете',
    };

    ai = new AiService(prisma, client as never, new IndexNowService(prisma));
    identity = new ProductIdentityService(prisma);
  });

  afterAll(async () => {
    process.env = env;
    await prisma.$disconnect();
  });

  it('previews what a task would write, with the same checks', async () => {
    const preview = await ai.preview({
      entity: 'PRODUCT',
      id: ids.bosch,
      fields: PRODUCT_FIELDS,
      templates: true,
    } as never);
    expect(preview.template).toBe('Аккумуляторный инструмент');
    expect(preview.rejected.descriptionFull?.reason).toMatch(/KickBack/);
    expect(preview.changes.name).toBeDefined();
  });

  it('splits a templates task by kind of product and runs it', async () => {
    const created = (await ai.createTask(
      {
        name: 'Пилот',
        entity: 'PRODUCT',
        fields: PRODUCT_FIELDS,
        templates: true,
        ids: [ids.bosch, ids.a4, ids.a50],
        batchSize: 5,
      } as never,
      'test',
    )) as unknown as { tasks: Array<{ name: string }> };
    expect(created.tasks.map((task) => task.name).sort()).toEqual([
      'Пилот — Аккумуляторный инструмент',
      'Пилот — Крепёж',
    ]);
    await runTasks();
  });

  it('writes what passed, keeps the old text where a check refused', async () => {
    const bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.name).toMatch(/^Аккумуляторный перфоратор Bosch/);
    expect(bosch.descriptionFull).toMatch(/^Особенности/);
    expect(bosch.aiLockedFields).toEqual(
      expect.arrayContaining(['name', 'slug']),
    );
    expect(bosch.aiLockedFields).not.toContain('descriptionFull');

    const a4 = await prisma.product.findUniqueOrThrow({
      where: { id: ids.a4 },
    });
    expect(a4.name).toBe(
      'Анкер забиваемый STARFIX M10x12x40 мм, 4 шт. в зип-пакете',
    );
    expect(a4.aiLockedFields).not.toContain('seoDescription'); // no «безнал»

    const a50 = await prisma.product.findUniqueOrThrow({
      where: { id: ids.a50 },
    });
    expect(a50.name).toMatch(/^Анкер забиваемый М10х12х40 мм \(50 шт/); // the verifier objected
    expect(a50.slug).toBe('anker-50');

    const items = await prisma.aiTaskItem.findMany();
    const item = (id: string) => items.find((row) => row.entityId === id)!;
    expect(JSON.stringify(item(ids.bosch).rejected)).toMatch(/KickBack/);
    expect(JSON.stringify(item(ids.a50).rejected)).toMatch(/проверка смысла/);
    expect(
      JSON.stringify([item(ids.a4).warnings, item(ids.a50).warnings]),
    ).toMatch(/почти как у/);

    const tasks = await prisma.aiTask.findMany();
    expect(
      tasks.reduce((sum, task) => sum + task.promptTokens, 0),
    ).toBeGreaterThanOrEqual(4000);
  });

  it('moves the URL with the name and leaves a 301', async () => {
    const bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.slug).toMatch(
      /^akkumulyatornyi-perforator-bosch-gbh-18v-45-c/,
    );
    expect(bosch.slug.length).toBeLessThanOrEqual(90);
    expect(bosch.contentUpdatedAt.getTime()).toBeGreaterThan(
      bosch.createdAt.getTime(),
    );
    const redirect = await prisma.productRedirect.findUnique({
      where: { slug: OLD_BOSCH_SLUG },
    });
    expect(redirect?.productId).toBe(ids.bosch);

    const queued = (await prisma.indexNowUrl.findMany()).map((row) => row.url);
    expect(queued).toEqual(
      expect.arrayContaining([
        `https://gost.by/product/${bosch.slug}`,
        `https://gost.by/product/${OLD_BOSCH_SLUG}`,
        'https://gost.by/product/anker-4',
      ]),
    );
  });

  it('does not move the URL a second time', async () => {
    const before = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    answers[ids.bosch] = {
      name: 'Перфоратор аккумуляторный Bosch GBH 18V-45 C SDS-Max, 18 В, 12,5 Дж',
    };
    await ai.createTask(
      {
        name: 'Повтор',
        entity: 'PRODUCT',
        fields: ['name'],
        templates: true,
        ids: [ids.bosch],
      } as never,
      'test',
    );
    await runTasks();
    const after = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(after.name).toMatch(/^Перфоратор аккумуляторный/);
    expect(after.slug).toBe(before.slug);
  });

  it('keeps our name through a re-parse and flags a supplier rename', async () => {
    const save = (name: string, extra: Record<string, unknown> = {}) =>
      identity.save({
        sourceId: ids.tools,
        url: 'https://tools.by/product/1',
        baseSlug: 'x',
        data: {
          update: { name, ...extra },
          create: { name: 'x', slug: 'x', categoryId: ids.perf },
        } as never,
      });
    await save('Аккум. перфоратор BOSCH GBH 18V-45 C в чем.', {
      descriptionFull: 'Новое от поставщика',
    });
    let bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.name).toMatch(/^Перфоратор аккумуляторный/);
    expect(bosch.descriptionFull).toBe('Новое от поставщика');
    expect(bosch.supplierNameChangedAt).toBeNull();

    await save('Аккум. перфоратор BOSCH GBH 18V-45 CF в чем.');
    bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.supplierNameChange).toMatchObject({
      to: 'Аккум. перфоратор BOSCH GBH 18V-45 CF в чем.',
    });
  });

  it('lets a second supplier fill gaps only, and files specs under the real category', async () => {
    await prisma.sourceProduct.create({
      data: {
        sourceId: ids.th,
        url: 'https://th-tool.by/bosch',
        externalId: 'b',
        name: 'Перфоратор BOSCH GBH 18V-45 C',
        productId: ids.bosch,
        price: 6,
        specifications: {},
      } as never,
    });
    await identity.save({
      sourceId: ids.th,
      url: 'https://th-tool.by/bosch',
      baseSlug: 'x',
      data: {
        update: {
          descriptionFull: 'Текст th-tool',
          categoryId: ids.thPerf,
          stockStatus: 'out_of_stock',
        },
        create: { name: 'x', slug: 'x', categoryId: ids.thPerf },
      } as never,
    });
    const bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.categoryId).toBe(ids.perf);
    expect(bosch.descriptionFull).toBe('Новое от поставщика');
    expect(bosch.stockStatus).toBe('out_of_stock');

    await identity.saveSpecifications(
      [{ name: 'Вес, кг', value: '8' }],
      ids.bosch,
      ids.thPerf,
    );
    const weight = await prisma.productSpecification.findFirst({
      where: { productId: ids.bosch, specification: { name: 'Вес, кг' } },
      include: { specification: true },
    });
    expect(weight?.specification.categoryId).toBe(ids.perf);
  });

  it('reverts the first task: old name and old URL back, 301 from the AI one', async () => {
    const task = await prisma.aiTask.findFirstOrThrow({
      where: { name: 'Пилот — Аккумуляторный инструмент' },
    });
    const aiSlug = (
      await prisma.product.findUniqueOrThrow({ where: { id: ids.bosch } })
    ).slug;
    // The second task rewrote the name since: the first one must leave it.
    await ai.revert(task.id);
    let bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.slug).toBe(OLD_BOSCH_SLUG);
    expect(bosch.name).toMatch(/^Перфоратор аккумуляторный/);

    const second = await prisma.aiTask.findFirstOrThrow({
      where: { name: 'Повтор' },
    });
    await ai.revert(second.id);
    bosch = await prisma.product.findUniqueOrThrow({
      where: { id: ids.bosch },
    });
    expect(bosch.name).toMatch(/^Аккумуляторный перфоратор Bosch/);
    expect(bosch.aiLockedFields).not.toContain('slug');
    expect(
      (await prisma.productRedirect.findUnique({ where: { slug: aiSlug } }))
        ?.productId,
    ).toBe(ids.bosch);
    expect(
      await prisma.productRedirect.findUnique({
        where: { slug: OLD_BOSCH_SLUG },
      }),
    ).toBeNull();
  });
});
