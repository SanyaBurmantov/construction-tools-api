import { AiEntity, AiTaskItemStatus, AiTaskStatus } from '@prisma/client';
import { AiService } from './ai.service';

function build(options: {
  task?: Record<string, unknown>;
  product?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
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
  };
  return {
    service: new AiService(prisma as never, {} as never),
    prisma,
    productUpdate,
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
      data: { seoTitle: 'Старый', aiLockedFields: ['descriptionFull'] },
    });
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
