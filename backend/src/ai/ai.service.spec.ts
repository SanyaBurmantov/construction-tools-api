import { AiEntity, AiTaskItemStatus, AiTaskStatus } from '@prisma/client';
import { AiService } from './ai.service';

function build(options: {
  task?: Record<string, unknown>;
  product?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  redirect?: Record<string, unknown>;
}) {
  const productUpdate = jest.fn(() => Promise.resolve({}));
  const prisma = {
    aiTask: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 't1',
          entity: AiEntity.PRODUCT,
          status: AiTaskStatus.DONE,
          ...options.task,
        }),
      ),
      update: jest.fn(() => Promise.resolve({})),
      delete: jest.fn(() => Promise.resolve({})),
    },
    aiTaskItem: {
      findMany: jest.fn(() => Promise.resolve(options.items ?? [])),
      update: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    product: {
      findUnique: jest.fn(() => Promise.resolve(options.product ?? null)),
      update: productUpdate,
    },
    productRedirect: {
      findUnique: jest.fn(() => Promise.resolve(options.redirect ?? null)),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      upsert: jest.fn(() => Promise.resolve({})),
    },
    $transaction: jest.fn(),
  };
  // Interactive transactions run against the same mock.
  prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
    fn(prisma)) as never);
  const indexNow = { enqueue: jest.fn(() => Promise.resolve()) };
  return {
    service: new AiService(
      prisma as never,
      {} as never,
      indexNow as never,
      { effective: () => Promise.resolve({}) } as never,
    ),
    prisma,
    productUpdate,
    indexNow,
  };
}

describe('AiService.revert', () => {
  // Task A wrote the description, task B rewrote it since. Reverting A must
  // skip the field *and keep it locked*, or the next re-parse erases B's text.
  it('unlocks only the fields it actually restored', async () => {
    const { service, productUpdate } = build({
      items: [
        {
          id: 'i1',
          entityId: 'p1',
          status: AiTaskItemStatus.APPLIED,
          changes: {
            seoTitle: { old: 'Старый', new: 'ИИ-заголовок' },
            descriptionFull: { old: 'Поставщик', new: 'Текст задачи A' },
          },
        },
      ],
      product: {
        id: 'p1',
        slug: 'drel',
        name: 'Дрель',
        seoTitle: 'ИИ-заголовок',
        descriptionFull: 'Текст задачи B',
        aiLockedFields: ['seoTitle', 'descriptionFull'],
      },
    });

    const result = await service.revert('t1');

    expect(result).toEqual({ reverted: 1, skippedFields: 1 });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        seoTitle: 'Старый',
        aiLockedFields: ['descriptionFull'],
        contentUpdatedAt: expect.any(Date),
      },
    });
  });

  // The rename moved the URL; the revert moves it back and leaves a 301 on
  // the AI one, and tells Yandex about both.
  it('moves the URL back with the name', async () => {
    const { service, productUpdate, prisma, indexNow } = build({
      items: [
        {
          id: 'i1',
          entityId: 'p1',
          status: AiTaskItemStatus.APPLIED,
          changes: {
            name: { old: 'Аккум. дрель', new: 'Аккумуляторная дрель' },
            slug: { old: 'akkum-drel', new: 'akkumulyatornaya-drel' },
          },
        },
      ],
      product: {
        id: 'p1',
        name: 'Аккумуляторная дрель',
        slug: 'akkumulyatornaya-drel',
        aiLockedFields: ['name'],
      },
      // The old URL is this product's redirect now — free to take back.
      redirect: { productId: 'p1' },
    });

    await service.revert('t1');

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        name: 'Аккум. дрель',
        slug: 'akkum-drel',
        aiLockedFields: [],
        contentUpdatedAt: expect.any(Date),
      },
    });
    expect(prisma.productRedirect.deleteMany).toHaveBeenCalledWith({
      where: { slug: 'akkum-drel' },
    });
    expect(prisma.productRedirect.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'akkumulyatornaya-drel' } }),
    );
    expect(indexNow.enqueue).toHaveBeenCalledWith([
      '/product/akkum-drel',
      '/product/akkumulyatornaya-drel',
    ]);
  });
});

describe('AiService task state', () => {
  it('refuses to cancel a finished task', async () => {
    const { service } = build({ task: { status: AiTaskStatus.DONE } });
    await expect(service.cancel('t1')).rejects.toThrow('уже завершена');
  });

  it('refuses to retry a cancelled task before touching its items', async () => {
    const { service, prisma } = build({
      task: { status: AiTaskStatus.CANCELLED },
    });
    await expect(service.retryFailed('t1')).rejects.toThrow('отменена');
    expect(prisma.aiTaskItem.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to delete the task the runner is holding', async () => {
    const { service, prisma } = build({
      task: { status: AiTaskStatus.PAUSED },
    });
    service.activeTaskId = 't1';
    await expect(service.deleteTask('t1')).rejects.toThrow('выполняется');
    expect(prisma.aiTask.delete).not.toHaveBeenCalled();
  });
});

describe('AiService: the admin’s quoted phrase reaches the card', () => {
  const product = {
    id: 'p1',
    name: 'Бур SDS-plus 10х160 мм STARTUL',
    slug: 'bur-sds-plus-10x160',
    sku: 'ST4510',
    model: null,
    descriptionShort: null,
    descriptionFull: null,
    seoTitle: null,
    seoDescription: null,
    aiLockedFields: [],
    lockedFields: [],
    brand: { name: 'STARTUL' },
    category: { name: 'Буры', parent: null },
    productSpecs: [],
  };

  function runner(promptParts: Record<string, unknown> | null) {
    const productUpdate = jest.fn(() => Promise.resolve({}));
    const prisma = {
      aiTask: {
        update: jest.fn(() => Promise.resolve({})),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      aiTaskItem: {
        findMany: jest.fn(() =>
          Promise.resolve([{ id: 'i1', entityId: 'p1', attempts: 0 }]),
        ),
        update: jest.fn(() => Promise.resolve({})),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        groupBy: jest.fn(() => Promise.resolve([])),
      },
      productFamily: { findMany: jest.fn(() => Promise.resolve([])) },
      product: {
        findMany: jest.fn(() => Promise.resolve([product])),
        findUnique: jest.fn(() => Promise.resolve(product)),
        update: productUpdate,
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    const client = {
      chat: jest.fn(() =>
        Promise.resolve({
          model: 'deepseek-flash',
          usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 },
          content: JSON.stringify({
            items: [
              {
                id: 'p1',
                descriptionShort:
                  'Бур SDS-plus 10х160 мм для сверления бетона и кирпича перфоратором. Купить в Минске по низким ценам.',
              },
            ],
          }),
        }),
      ),
    };
    const service = new AiService(
      prisma as never,
      client as never,
      { enqueue: jest.fn(() => Promise.resolve()) } as never,
      { effective: () => Promise.resolve({}) } as never,
    );
    const task = {
      id: 't1',
      entity: AiEntity.PRODUCT,
      status: AiTaskStatus.RUNNING,
      fields: ['descriptionShort'],
      promptText: 'x',
      promptParts,
      model: 'deepseek-flash',
      batchSize: 5,
      startedAt: new Date(),
    };
    return { service, task, productUpdate, client };
  }

  const verify = process.env.AI_VERIFY;
  beforeAll(() => (process.env.AI_VERIFY = 'false'));
  afterAll(() => (process.env.AI_VERIFY = verify));

  it('writes the sentence the task quoted', async () => {
    const { service, task, productUpdate } = runner({
      general: '',
      fields: {
        descriptionShort: 'В конце добавь «купить в Минске по низким ценам».',
      },
    });
    await service.runBatch(task as never);
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          descriptionShort:
            'Бур SDS-plus 10х160 мм для сверления бетона и кирпича перфоратором. Купить в Минске по низким ценам.',
        }),
      }),
    );
  });

  it('without the quote the same sentence is cut as supplier boilerplate', async () => {
    const { service, task, productUpdate } = runner(null);
    await service.runBatch(task as never);
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          descriptionShort:
            'Бур SDS-plus 10х160 мм для сверления бетона и кирпича перфоратором.',
        }),
      }),
    );
  });
});

describe('AiService.revert for a brand', () => {
  it('puts the name back into a NOT NULL SEO field and pings the brand page', async () => {
    const brandUpdate = jest.fn(() => Promise.resolve({}));
    const enqueue = jest.fn(() => Promise.resolve());
    const prisma = {
      aiTask: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 't1', entity: AiEntity.BRAND }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
      aiTaskItem: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'i1',
              entityId: 'b1',
              status: AiTaskItemStatus.APPLIED,
              changes: {
                seoTitle: { old: null, new: 'STARTUL: ручной инструмент' },
              },
            },
          ]),
        ),
        update: jest.fn(() => Promise.resolve({})),
        groupBy: jest.fn(() => Promise.resolve([])),
      },
      brand: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            name: 'STARTUL',
            slug: 'startul',
            seoTitle: 'STARTUL: ручной инструмент',
          }),
        ),
        update: brandUpdate,
      },
    };
    const service = new AiService(
      prisma as never,
      {} as never,
      { enqueue } as never,
      { effective: () => Promise.resolve({}) } as never,
    );
    await service.revert('t1');
    expect(brandUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { seoTitle: 'STARTUL' },
    });
    expect(enqueue).toHaveBeenCalledWith(['/brand/startul']);
  });
});

describe('AiService: «Отклонённое»', () => {
  function rejectedItem(extra: Record<string, unknown> = {}) {
    const productUpdate = jest.fn(() => Promise.resolve({}));
    const itemUpdate = jest.fn(() => Promise.resolve({}));
    const prisma = {
      aiTaskItem: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'i1',
            taskId: 't1',
            entityId: 'p1',
            status: AiTaskItemStatus.UNCHANGED,
            changes: {},
            rejected: { seoTitle: 'число 12 не из данных товара' },
            resolved: null,
            task: { entity: AiEntity.PRODUCT },
            ...extra,
          }),
        ),
        update: itemUpdate,
        groupBy: jest.fn(() => Promise.resolve([])),
      },
      aiTask: { update: jest.fn(() => Promise.resolve({})) },
      product: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            name: 'Бур',
            slug: 'bur',
            seoTitle: 'Старый',
            aiLockedFields: [],
            lockedFields: [],
          }),
        ),
        update: productUpdate,
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    const service = new AiService(
      prisma as never,
      {} as never,
      { enqueue: jest.fn(() => Promise.resolve()) } as never,
      { effective: () => Promise.resolve({}) } as never,
    );
    return { service, productUpdate, itemUpdate };
  }

  it('writes the admin’s text, locks it and marks the field applied', async () => {
    const { service, productUpdate, itemUpdate } = rejectedItem();
    await service.applyRejected('i1', 'seoTitle', '  Бур SDS-plus 12 мм  ');
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seoTitle: 'Бур SDS-plus 12 мм',
          aiLockedFields: ['seoTitle'],
        }),
      }),
    );
    expect(itemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AiTaskItemStatus.APPLIED,
          resolved: { seoTitle: 'applied' },
          changes: { seoTitle: { old: 'Старый', new: 'Бур SDS-plus 12 мм' } },
        }),
      }),
    );
  });

  it('dismiss keeps the text and only marks the field', async () => {
    const { service, productUpdate, itemUpdate } = rejectedItem();
    await service.dismissRejected('i1', 'seoTitle');
    expect(productUpdate).not.toHaveBeenCalled();
    expect(itemUpdate).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { resolved: { seoTitle: 'dismissed' } },
    });
  });

  it('refuses a field that was not refused, or one already dealt with', async () => {
    await expect(
      rejectedItem().service.applyRejected('i1', 'descriptionFull', 'x'),
    ).rejects.toThrow('не отклонялось');
    await expect(
      rejectedItem({
        resolved: { seoTitle: 'dismissed' },
      }).service.dismissRejected('i1', 'seoTitle'),
    ).rejects.toThrow('Уже разобрано');
  });
});

describe('AiService.checkAndRepair', () => {
  const context = {
    current: { descriptionFull: 'Старый текст поставщика про ключи.' },
    prompt: { id: 'p1' },
    kind: { name: 'Ключи', categoryPath: '' },
    validation: {
      entity: AiEntity.PRODUCT,
      oldName: 'Ключи',
      source: 'Ключи набор 10 инструментов',
    },
  };
  const fields = [
    { key: 'descriptionFull', label: 'Полное описание', hint: '' },
  ];

  function build(firstVerdict: Record<string, string>) {
    const chat = jest.fn(() =>
      Promise.resolve({
        content: JSON.stringify({
          items: [
            {
              id: 'p1',
              descriptionFull:
                'Свой новый текст про набор ключей: десять инструментов в одном наборе закрывают типовые размеры крепежа, поэтому в мастерской и на выезде не придётся искать недостающий ключ. Набор удобно хранить и переносить.',
            },
          ],
        }),
        usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 },
        model: 'm',
      }),
    );
    const check = jest
      .fn()
      .mockResolvedValueOnce(
        new Map([
          [
            'p1',
            {
              quality: { descriptionFull: { uniqueness: 20 } },
              rejected: firstVerdict,
              copied: { descriptionFull: ['текст поставщика про ключи'] },
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            'p1',
            {
              quality: { descriptionFull: { uniqueness: 90 } },
              rejected: {},
              copied: {},
            },
          ],
        ]),
      );
    const service = new AiService(
      { aiTask: { update: jest.fn(() => Promise.resolve({})) } } as never,
      { chat } as never,
      {} as never,
      {} as never,
      { check } as never,
    );
    return { service, chat, check };
  }

  it('asks again for a failed field, with the reason and the copied piece, and re-checks it', async () => {
    const { service, chat, check } = build({
      descriptionFull: 'уникальность 20%',
    });
    const result = await (
      service as never as {
        checkAndRepair: (p: unknown) => Promise<{
          records: Map<string, Record<string, unknown>>;
          checks: Map<
            string,
            { quality: Record<string, { uniqueness: number }> }
          >;
          repairs: number;
        }>;
      }
    ).checkAndRepair({
      model: 'm',
      taskId: 't1',
      entity: AiEntity.PRODUCT,
      fields,
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      answer:
        '{"items":[{"id":"p1","descriptionFull":"Старый текст поставщика про ключи."}]}',
      records: new Map([
        [
          'p1',
          { id: 'p1', descriptionFull: 'Старый текст поставщика про ключи!' },
        ],
      ]),
      contexts: new Map([['p1', context]]),
      phrases: [],
    });
    expect(result.repairs).toBe(1);
    expect(result.records.get('p1')!.descriptionFull).toBe(
      'Свой новый текст про набор ключей: десять инструментов в одном наборе закрывают типовые размеры крепежа, поэтому в мастерской и на выезде не придётся искать недостающий ключ. Набор удобно хранить и переносить.',
    );
    expect(result.checks.get('p1')!.quality.descriptionFull.uniqueness).toBe(
      90,
    );
    const sent = (
      chat.mock.calls[0] as unknown as [
        string,
        Array<{ role: string; content: string }>,
      ]
    )[1];
    expect(sent.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(sent[3].content).toMatch(
      /уникальность 20%.*«текст поставщика про ключи»/s,
    );
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('nothing failed — no second request', async () => {
    const { service, chat } = build({});
    const result = await (
      service as never as {
        checkAndRepair: (p: unknown) => Promise<{ repairs: number }>;
      }
    ).checkAndRepair({
      model: 'm',
      taskId: null,
      entity: AiEntity.PRODUCT,
      fields,
      messages: [],
      answer: '',
      records: new Map([
        [
          'p1',
          {
            id: 'p1',
            descriptionFull:
              'Свой новый текст про набор ключей: десять инструментов в одном наборе закрывают типовые размеры крепежа, поэтому в мастерской и на выезде не придётся искать недостающий ключ. Набор удобно хранить и переносить.',
          },
        ],
      ]),
      contexts: new Map([['p1', context]]),
      phrases: [],
    });
    expect(result.repairs).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });
});
