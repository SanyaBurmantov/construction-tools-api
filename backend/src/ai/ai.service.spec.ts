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
    service: new AiService(prisma as never, {} as never, indexNow as never),
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
