import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AiEntity,
  AiTask,
  AiTaskItemStatus,
  AiTaskStatus,
  Prisma,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_FIELDS,
  buildMessages,
  diffAnswer,
  fieldDefs,
  FieldChange,
  isKnownField,
  parseAnswer,
  truncate,
} from './ai-fields';
import {
  AiCategoryFilterDto,
  AiCategoryQueryDto,
  AiCreateTaskDto,
  AiPreviewDto,
  AiProductFilterDto,
  AiProductQueryDto,
  AiPromptDto,
  AiTaskItemsQueryDto,
  AiTaskListQueryDto,
  AiUpdatePromptDto,
  MAX_TASK_ITEMS,
} from './dto/ai.dto';
import { AiRateLimitError, OpenRouterClient } from './openrouter.client';

/** A batch that fails this many times marks its items FAILED for good. */
const MAX_ATTEMPTS = 3;
const SPEC_LIMIT = 25;
const DESCRIPTION_CONTEXT_CHARS = 2500;

export type BatchOutcome = 'done' | 'progress' | 'rate-limited' | 'error';

/** The answer's fields that were asked for, nothing else. */
function pickFields(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => key in record).map((key) => [key, record[key]]),
  );
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterClient,
  ) {}

  /* ---- Status ---------------------------------------------------------- */

  async status() {
    const [quota, active] = await Promise.all([
      this.openRouter.quota(),
      this.prisma.aiTask.count({
        where: { status: { in: [AiTaskStatus.QUEUED, AiTaskStatus.RUNNING] } },
      }),
    ]);
    return {
      enabled: this.openRouter.enabled,
      defaultModel: this.openRouter.defaultModel,
      quota,
      activeTasks: active,
      fields: AI_FIELDS,
    };
  }

  models() {
    return this.openRouter.freeModels();
  }

  /* ---- Pickers --------------------------------------------------------- */

  async listProducts(query: AiProductQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = await this.productWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          status: true,
          stockStatus: true,
          descriptionShort: true,
          descriptionFull: true,
          seoTitle: true,
          seoDescription: true,
          aiLockedFields: true,
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          images: { select: { url: true }, take: 1 },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: rows.map(
        ({
          descriptionShort,
          descriptionFull,
          seoTitle,
          seoDescription,
          images,
          ...row
        }) => ({
          ...row,
          image: images[0]?.url ?? null,
          // Lengths, not texts: the grid shows what is filled in, and 50 full
          // descriptions would be most of the payload.
          lengths: {
            descriptionShort: descriptionShort?.length ?? 0,
            descriptionFull: descriptionFull?.length ?? 0,
            seoTitle: seoTitle?.length ?? 0,
            seoDescription: seoDescription?.length ?? 0,
          },
        }),
      ),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async listCategories(query: AiCategoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = await this.categoryWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          level: true,
          isVisible: true,
          description: true,
          seoTitle: true,
          seoDescription: true,
          parent: { select: { id: true, name: true } },
          _count: { select: { products: true, children: true } },
        },
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      data: rows.map(({ description, seoTitle, seoDescription, ...row }) => ({
        ...row,
        lengths: {
          description: description?.length ?? 0,
          seoTitle: seoTitle?.length ?? 0,
          seoDescription: seoDescription?.length ?? 0,
        },
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  private async productWhere(
    filter: AiProductFilterDto,
  ): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [];
    const search = filter.search?.trim();
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (filter.categoryId) {
      and.push({
        categoryId: { in: await this.subtreeIds(filter.categoryId) },
      });
    }
    const brandIds = filter.brandId
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (brandIds?.length) and.push({ brandId: { in: brandIds } });
    if (filter.sourceId) {
      and.push({ sourceProducts: { some: { sourceId: filter.sourceId } } });
    }
    if (filter.status) and.push({ status: filter.status });
    if (filter.stock === 'in_stock') and.push({ stockStatus: 'in_stock' });
    if (filter.stock === 'out_of_stock') {
      and.push({ NOT: { stockStatus: 'in_stock' } });
    }
    if (filter.missing) {
      and.push({ OR: [{ [filter.missing]: null }, { [filter.missing]: '' }] });
    }
    if (filter.ai === 'yes')
      and.push({ NOT: { aiLockedFields: { isEmpty: true } } });
    if (filter.ai === 'no') and.push({ aiLockedFields: { isEmpty: true } });
    return and.length ? { AND: and } : {};
  }

  private async categoryWhere(
    filter: AiCategoryFilterDto,
  ): Promise<Prisma.CategoryWhereInput> {
    const and: Prisma.CategoryWhereInput[] = [];
    const search = filter.search?.trim();
    if (search) and.push({ name: { contains: search, mode: 'insensitive' } });
    if (filter.parentId) {
      and.push({ id: { in: await this.subtreeIds(filter.parentId) } });
    }
    if (filter.level !== undefined) and.push({ level: filter.level });
    if (filter.visible) and.push({ isVisible: filter.visible === 'yes' });
    if (filter.missing === 'description') {
      and.push({ OR: [{ description: null }, { description: '' }] });
    }
    return and.length ? { AND: and } : {};
  }

  private async subtreeIds(rootId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Category" WHERE id = ${rootId}
        UNION ALL
        SELECT c.id FROM "Category" c JOIN sub ON c."parentId" = sub.id
      )
      SELECT id FROM sub`;
    return rows.map((row) => row.id);
  }

  /* ---- Prompts --------------------------------------------------------- */

  listPrompts(entity?: AiEntity) {
    return this.prisma.aiPrompt.findMany({
      where: entity ? { entity } : {},
      orderBy: { name: 'asc' },
    });
  }

  createPrompt(dto: AiPromptDto) {
    return this.prisma.aiPrompt.create({
      data: {
        name: dto.name.trim(),
        entity: dto.entity,
        text: dto.text.trim(),
      },
    });
  }

  async updatePrompt(id: string, dto: AiUpdatePromptDto) {
    await this.ensurePrompt(id);
    return this.prisma.aiPrompt.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
      },
    });
  }

  async deletePrompt(id: string) {
    await this.ensurePrompt(id);
    // Tasks keep their own copy of the text; the link is nulled.
    await this.prisma.aiPrompt.delete({ where: { id } });
    return { ok: true };
  }

  private async ensurePrompt(id: string) {
    const prompt = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('Промпт не найден');
    return prompt;
  }

  /* ---- Tasks ----------------------------------------------------------- */

  async createTask(dto: AiCreateTaskDto, createdBy: string | null) {
    const fields = [...new Set(dto.fields)];
    const unknown = fields.filter((key) => !isKnownField(dto.entity, key));
    if (unknown.length) {
      throw new BadRequestException(
        `Поле нельзя обновлять: ${unknown.join(', ')}`,
      );
    }
    if (dto.promptId) await this.ensurePrompt(dto.promptId);

    const ids = dto.ids?.length
      ? [...new Set(dto.ids)]
      : dto.filter
        ? await this.idsByFilter(dto.entity, dto.filter)
        : [];
    if (!ids.length)
      throw new BadRequestException('Не выбрано ни одной записи');
    if (ids.length > MAX_TASK_ITEMS) {
      throw new BadRequestException(
        `Под фильтр попало ${ids.length} записей — не больше ${MAX_TASK_ITEMS} за одну задачу`,
      );
    }

    const entities = await this.entityNames(dto.entity, ids);
    if (!entities.length)
      throw new BadRequestException('Выбранные записи не найдены');

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiTask.create({
        data: {
          name: dto.name.trim(),
          entity: dto.entity,
          fields,
          promptId: dto.promptId ?? null,
          promptText: dto.prompt.trim(),
          model: dto.model?.trim() || this.openRouter.defaultModel,
          batchSize: dto.batchSize ?? 5,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
          total: entities.length,
          createdBy,
        },
      });
      await tx.aiTaskItem.createMany({
        data: entities.map((entity) => ({
          taskId: created.id,
          entityId: entity.id,
          entityName: entity.name,
        })),
      });
      return created;
    });
    return task;
  }

  private async idsByFilter(entity: AiEntity, raw: Record<string, unknown>) {
    const Dto =
      entity === AiEntity.PRODUCT ? AiProductFilterDto : AiCategoryFilterDto;
    const filter = plainToInstance(Dto, raw);
    const errors = validateSync(filter, { whitelist: true });
    if (errors.length) throw new BadRequestException('Некорректный фильтр');

    const take = MAX_TASK_ITEMS + 1;
    const rows =
      entity === AiEntity.PRODUCT
        ? await this.prisma.product.findMany({
            where: await this.productWhere(filter),
            select: { id: true },
            orderBy: { name: 'asc' },
            take,
          })
        : await this.prisma.category.findMany({
            where: await this.categoryWhere(filter as AiCategoryFilterDto),
            select: { id: true },
            orderBy: { name: 'asc' },
            take,
          });
    return rows.map((row) => row.id);
  }

  private entityNames(entity: AiEntity, ids: string[]) {
    const select = { id: true, name: true } as const;
    return entity === AiEntity.PRODUCT
      ? this.prisma.product.findMany({ where: { id: { in: ids } }, select })
      : this.prisma.category.findMany({ where: { id: { in: ids } }, select });
  }

  async listTasks(query: AiTaskListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = query.entity ? { entity: query.entity } : {};
    const [data, total] = await Promise.all([
      this.prisma.aiTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { prompt: { select: { id: true, name: true } } },
      }),
      this.prisma.aiTask.count({ where }),
    ]);
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getTask(id: string) {
    const task = await this.prisma.aiTask.findUnique({
      where: { id },
      include: { prompt: { select: { id: true, name: true } } },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    const counts = await this.prisma.aiTaskItem.groupBy({
      by: ['status'],
      where: { taskId: id },
      _count: { _all: true },
    });
    return {
      ...task,
      counts: Object.fromEntries(
        counts.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async getItems(taskId: string, query: AiTaskItemsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.AiTaskItemWhereInput = {
      taskId,
      ...(query.status ? { status: query.status as AiTaskItemStatus } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.aiTaskItem.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { entityName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.aiTaskItem.count({ where }),
    ]);
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async pause(id: string) {
    const task = await this.requireTask(id);
    if (
      task.status !== AiTaskStatus.QUEUED &&
      task.status !== AiTaskStatus.RUNNING
    ) {
      throw new ConflictException(
        'Приостановить можно только задачу в очереди',
      );
    }
    return this.prisma.aiTask.update({
      where: { id },
      data: { status: AiTaskStatus.PAUSED },
    });
  }

  async resume(id: string, scheduledAt?: string) {
    const task = await this.requireTask(id);
    if (task.status === AiTaskStatus.CANCELLED) {
      throw new ConflictException('Задача отменена');
    }
    const pending = await this.prisma.aiTaskItem.count({
      where: { taskId: id, status: AiTaskItemStatus.PENDING },
    });
    if (!pending)
      throw new ConflictException(
        'В задаче не осталось необработанных записей',
      );
    return this.prisma.aiTask.update({
      where: { id },
      data: {
        status: AiTaskStatus.QUEUED,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
        pausedUntil: null,
        finishedAt: null,
      },
    });
  }

  async cancel(id: string) {
    const task = await this.requireTask(id);
    // A finished task stays finished; cancelling it rewrote its history.
    if (
      task.status === AiTaskStatus.DONE ||
      task.status === AiTaskStatus.CANCELLED
    ) {
      throw new ConflictException('Задача уже завершена');
    }
    return this.prisma.aiTask.update({
      where: { id },
      data: { status: AiTaskStatus.CANCELLED, finishedAt: new Date() },
    });
  }

  /** FAILED items back to PENDING and the task back into the queue. */
  async retryFailed(id: string) {
    const task = await this.requireTask(id);
    // Checked before touching items: resume() refuses a cancelled task, and
    // the items were already reset by then, leaving the counts wrong.
    if (task.status === AiTaskStatus.CANCELLED) {
      throw new ConflictException('Задача отменена — создайте новую');
    }
    const { count } = await this.prisma.aiTaskItem.updateMany({
      where: { taskId: id, status: AiTaskItemStatus.FAILED },
      data: { status: AiTaskItemStatus.PENDING, attempts: 0, error: null },
    });
    if (!count) throw new ConflictException('Нет записей с ошибкой');
    await this.recount(id);
    return this.resume(id);
  }

  async deleteTask(id: string) {
    const task = await this.requireTask(id);
    // `activeTaskId`: a paused or queued task can still have a batch in
    // flight; deleting it under the runner left products changed and locked
    // with no record to revert them from.
    if (task.status === AiTaskStatus.RUNNING || this.activeTaskId === id) {
      throw new ConflictException(
        'Задача выполняется — сначала приостановите её',
      );
    }
    await this.prisma.aiTask.delete({ where: { id } });
    return { ok: true };
  }

  private async requireTask(id: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');
    return task;
  }

  /* ---- Revert ---------------------------------------------------------- */

  /** Rolls back every applied item of a task (or the one given). */
  async revert(taskId: string, itemId?: string) {
    const task = await this.requireTask(taskId);
    const items = await this.prisma.aiTaskItem.findMany({
      where: {
        taskId,
        status: AiTaskItemStatus.APPLIED,
        ...(itemId ? { id: itemId } : {}),
      },
    });
    if (!items.length) throw new ConflictException('Нечего откатывать');

    let reverted = 0;
    let skippedFields = 0;
    for (const item of items) {
      const changes = (item.changes ?? {}) as Record<string, FieldChange>;
      const result = await this.revertEntity(
        task.entity,
        item.entityId,
        changes,
      );
      skippedFields += result.skipped;
      await this.prisma.aiTaskItem.update({
        where: { id: item.id },
        data: { status: AiTaskItemStatus.REVERTED },
      });
      reverted++;
    }
    await this.recount(taskId);
    return { reverted, skippedFields };
  }

  /**
   * Puts the old values back — but only where the field still holds what the
   * AI wrote. A field someone edited since keeps the newer edit.
   */
  private async revertEntity(
    entity: AiEntity,
    id: string,
    changes: Record<string, FieldChange>,
  ) {
    const keys = Object.keys(changes);
    const current = await this.currentValues(entity, id, keys);
    if (!current) return { skipped: keys.length };

    const data: Record<string, string | null> = {};
    let skipped = 0;
    for (const key of keys) {
      if (current[key] === changes[key].new) {
        // Category SEO columns are NOT NULL — fall back to the name.
        data[key] =
          changes[key].old ??
          (entity === AiEntity.CATEGORY && key !== 'description'
            ? typeof current.name === 'string'
              ? current.name
              : ''
            : null);
      } else {
        skipped++;
      }
    }

    if (entity === AiEntity.PRODUCT) {
      // Unlock only what was actually restored. A skipped field holds a newer
      // AI task's text or an admin's edit; unlocking it let the next re-parse
      // put the supplier text back over that work.
      const restored = Object.keys(data);
      const locked = ((current.aiLockedFields as string[]) ?? []).filter(
        (key) => !restored.includes(key),
      );
      await this.prisma.product.update({
        where: { id },
        data: { ...data, aiLockedFields: locked },
      });
    } else if (Object.keys(data).length) {
      await this.prisma.category.update({ where: { id }, data });
    }
    return { skipped };
  }

  /* ---- Preview --------------------------------------------------------- */

  /** One live call for one entity, nothing written. Costs one request. */
  async preview(dto: AiPreviewDto) {
    const fields = fieldDefs(dto.entity, dto.fields);
    if (!fields.length) throw new BadRequestException('Не выбраны поля');
    const contexts = await this.contexts(dto.entity, [dto.id]);
    const context = contexts.get(dto.id);
    if (!context) throw new NotFoundException('Запись не найдена');

    const messages = buildMessages({
      entity: dto.entity,
      fields,
      instruction: dto.prompt,
      contexts: [context.prompt],
    });
    const model = dto.model || this.openRouter.defaultModel;
    try {
      const answer = await this.openRouter.chat(model, messages);
      const parsed = parseAnswer(answer.content);
      const record = parsed.get(dto.id) ?? [...parsed.values()][0] ?? {};
      return {
        model: answer.model,
        changes: diffAnswer(fields, context.current, record),
        raw: answer.content,
      };
    } catch (error) {
      if (error instanceof AiRateLimitError) {
        throw new ConflictException(error.message);
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  /* ---- Runner ---------------------------------------------------------- */

  /** The task the runner holds right now (see `deleteTask`). */
  activeTaskId: string | null = null;

  /**
   * The free tier's limit is per *key*, not per task. Remembered here so the
   * other queued tasks do not each spend a request discovering the same 429.
   */
  private quotaResetsAt: Date | null = null;

  /** The task the runner should work on now, if any. */
  async nextRunnableTask() {
    const now = new Date();
    if (this.quotaResetsAt && this.quotaResetsAt > now) return null;
    return this.prisma.aiTask.findFirst({
      where: {
        status: { in: [AiTaskStatus.QUEUED, AiTaskStatus.RUNNING] },
        scheduledAt: { lte: now },
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
      },
      // A task already running finishes before the next one starts.
      orderBy: [{ status: 'desc' }, { scheduledAt: 'asc' }],
    });
  }

  /** Processes one batch of a task. */
  async runBatch(task: AiTask): Promise<BatchOutcome> {
    this.activeTaskId = task.id;
    try {
      return await this.runBatchInner(task);
    } finally {
      this.activeTaskId = null;
    }
  }

  private async runBatchInner(task: AiTask): Promise<BatchOutcome> {
    const items = await this.prisma.aiTaskItem.findMany({
      where: { taskId: task.id, status: AiTaskItemStatus.PENDING },
      orderBy: { entityName: 'asc' },
      take: task.batchSize,
    });
    if (!items.length) {
      await this.finish(task.id);
      return 'done';
    }

    if (task.status !== AiTaskStatus.RUNNING) {
      // Conditional, so a pause that landed after the task was picked wins.
      await this.prisma.aiTask.updateMany({
        where: { id: task.id, status: AiTaskStatus.QUEUED },
        data: {
          status: AiTaskStatus.RUNNING,
          startedAt: task.startedAt ?? new Date(),
        },
      });
    }

    const fields = fieldDefs(task.entity, task.fields);
    const contexts = await this.contexts(
      task.entity,
      items.map((item) => item.entityId),
    );

    const live = items.filter((item) => contexts.has(item.entityId));
    const gone = items.filter((item) => !contexts.has(item.entityId));
    if (gone.length) {
      await this.prisma.aiTaskItem.updateMany({
        where: { id: { in: gone.map((item) => item.id) } },
        data: { status: AiTaskItemStatus.FAILED, error: 'Запись удалена' },
      });
    }

    let outcome: BatchOutcome = 'progress';
    if (live.length) {
      outcome = await this.callAndApply(task, fields, live, contexts);
    }
    await this.recount(task.id);
    return outcome;
  }

  private async callAndApply(
    task: AiTask,
    fields: ReturnType<typeof fieldDefs>,
    items: Array<{ id: string; entityId: string; attempts: number }>,
    contexts: Map<string, EntityContext>,
  ): Promise<BatchOutcome> {
    const messages = buildMessages({
      entity: task.entity,
      fields,
      instruction: task.promptText,
      contexts: items.map((item) => contexts.get(item.entityId)!.prompt),
    });

    let answers: Map<string, Record<string, unknown>>;
    try {
      const answer = await this.openRouter.chat(task.model, messages);
      answers = parseAnswer(answer.content);
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof AiRateLimitError) {
        // The quota, not the batch, is the problem: nothing is charged to the
        // items, the task just sleeps until the limit resets.
        this.quotaResetsAt = error.retryAt;
        await this.prisma.aiTask.update({
          where: { id: task.id },
          data: { pausedUntil: error.retryAt, lastError: message },
        });
        this.logger.warn(
          `AI task ${task.id}: ${message}; retry at ${error.retryAt.toISOString()}`,
        );
        return 'rate-limited';
      }
      this.logger.warn(`AI task ${task.id}: batch failed — ${message}`);
      await this.chargeAttempt(items, message);
      await this.prisma.aiTask.update({
        where: { id: task.id },
        data: { lastError: message },
      });
      return 'error';
    }

    // A single-item batch whose answer came back with a mangled id is still
    // unambiguous.
    const lone =
      items.length === 1 && answers.size === 1
        ? [...answers.values()][0]
        : null;

    for (const item of items) {
      const record = answers.get(item.entityId) ?? lone;
      if (!record) {
        await this.chargeAttempt([item], 'Нет в ответе модели');
        continue;
      }
      try {
        // One transaction for the write and its record, against values read
        // *now*: the context was loaded before a model call that can take two
        // minutes, so an admin edit in that window was overwritten and the
        // stored `old` was wrong; and a crash between two separate writes
        // left a changed product with no record to revert it from.
        await this.prisma.$transaction(async (tx) => {
          const current = await this.currentValues(
            task.entity,
            item.entityId,
            fields.map((field) => field.key),
            tx,
          );
          if (!current) throw new Error('Запись удалена');
          const changes = diffAnswer(fields, current, record);
          await this.applyChanges(
            task.entity,
            item.entityId,
            changes,
            current,
            tx,
          );
          await tx.aiTaskItem.update({
            where: { id: item.id },
            data: {
              status: Object.keys(changes).length
                ? AiTaskItemStatus.APPLIED
                : AiTaskItemStatus.UNCHANGED,
              attempts: { increment: 1 },
              changes: changes as Prisma.InputJsonValue,
              // Only the fields asked for: the model may invent extra keys.
              response: pickFields(
                record,
                fields.map((field) => field.key),
              ) as Prisma.InputJsonValue,
              error: null,
            },
          });
        });
      } catch (error) {
        await this.chargeAttempt([item], (error as Error).message);
      }
    }
    return 'progress';
  }

  private async applyChanges(
    entity: AiEntity,
    id: string,
    changes: Record<string, FieldChange>,
    current: Record<string, unknown>,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const keys = Object.keys(changes);
    if (!keys.length) return;
    const data = Object.fromEntries(keys.map((key) => [key, changes[key].new]));

    if (entity === AiEntity.PRODUCT) {
      // Lock what was written, or tomorrow's re-parse puts the supplier's
      // text back (see ProductIdentityService.save).
      const locked = new Set([
        ...((current.aiLockedFields as string[]) ?? []),
        ...keys,
      ]);
      await db.product.update({
        where: { id },
        data: { ...data, aiLockedFields: [...locked] },
      });
    } else {
      await db.category.update({ where: { id }, data });
    }
  }

  private async chargeAttempt(
    items: Array<{ id: string; attempts: number }>,
    error: string,
  ) {
    for (const item of items) {
      const attempts = item.attempts + 1;
      await this.prisma.aiTaskItem.update({
        where: { id: item.id },
        data: {
          attempts,
          error: error.slice(0, 1000),
          status:
            attempts >= MAX_ATTEMPTS
              ? AiTaskItemStatus.FAILED
              : AiTaskItemStatus.PENDING,
        },
      });
    }
  }

  private async finish(taskId: string) {
    await this.recount(taskId);
    await this.prisma.aiTask.updateMany({
      where: {
        id: taskId,
        status: { in: [AiTaskStatus.QUEUED, AiTaskStatus.RUNNING] },
      },
      data: {
        status: AiTaskStatus.DONE,
        finishedAt: new Date(),
        pausedUntil: null,
      },
    });
  }

  private async recount(taskId: string) {
    const counts = await this.prisma.aiTaskItem.groupBy({
      by: ['status'],
      where: { taskId },
      _count: { _all: true },
    });
    const by = (status: AiTaskItemStatus) =>
      counts.find((row) => row.status === status)?._count._all ?? 0;
    const total = counts.reduce((sum, row) => sum + row._count._all, 0);
    await this.prisma.aiTask.update({
      where: { id: taskId },
      data: {
        total,
        processed: total - by(AiTaskItemStatus.PENDING),
        applied: by(AiTaskItemStatus.APPLIED),
        failed: by(AiTaskItemStatus.FAILED),
      },
    });
  }

  /* ---- Context --------------------------------------------------------- */

  private async currentValues(
    entity: AiEntity,
    id: string,
    keys: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const select = Object.fromEntries(
      [...keys, 'name'].map((key) => [key, true]),
    );
    if (entity === AiEntity.PRODUCT) {
      return db.product.findUnique({
        where: { id },
        select: { ...select, aiLockedFields: true },
      }) as Promise<Record<string, unknown> | null>;
    }
    return db.category.findUnique({
      where: { id },
      select,
    }) as Promise<Record<string, unknown> | null>;
  }

  /**
   * What the model sees (`prompt`) and what the answer is diffed against
   * (`current`). Kept small: free models have modest context windows and the
   * whole batch goes in one request.
   */
  private async contexts(entity: AiEntity, ids: string[]) {
    const map = new Map<string, EntityContext>();

    if (entity === AiEntity.PRODUCT) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: ids } },
        include: {
          brand: { select: { name: true } },
          category: {
            select: {
              name: true,
              parent: {
                select: { name: true, parent: { select: { name: true } } },
              },
            },
          },
          productSpecs: {
            take: SPEC_LIMIT,
            select: { value: true, specification: { select: { name: true } } },
          },
        },
      });
      for (const product of products) {
        const category = [
          product.category.parent?.parent?.name,
          product.category.parent?.name,
          product.category.name,
        ].filter(Boolean);
        map.set(product.id, {
          current: product as unknown as Record<string, unknown>,
          prompt: {
            id: product.id,
            name: product.name,
            brand: product.brand?.name ?? null,
            category: category.join(' / '),
            sku: product.sku,
            model: product.model,
            price: product.priceValue,
            inStock: product.stockStatus === 'in_stock',
            descriptionShort: product.descriptionShort,
            descriptionFull: truncate(
              product.descriptionFull,
              DESCRIPTION_CONTEXT_CHARS,
            ),
            seoTitle: product.seoTitle,
            seoDescription: product.seoDescription,
            specs: Object.fromEntries(
              product.productSpecs.map((spec) => [
                spec.specification.name,
                spec.value,
              ]),
            ),
          },
        });
      }
      return map;
    }

    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      include: {
        parent: { select: { name: true, parent: { select: { name: true } } } },
        children: {
          select: { name: true },
          take: 20,
          orderBy: { name: 'asc' },
        },
        products: {
          where: { status: 'PUBLISHED' },
          select: { name: true },
          take: 10,
        },
        _count: { select: { products: true } },
      },
    });
    for (const category of categories) {
      map.set(category.id, {
        current: category as unknown as Record<string, unknown>,
        prompt: {
          id: category.id,
          name: category.name,
          parents: [category.parent?.parent?.name, category.parent?.name]
            .filter(Boolean)
            .join(' / '),
          description: truncate(
            category.description,
            DESCRIPTION_CONTEXT_CHARS,
          ),
          seoTitle: category.seoTitle,
          seoDescription: category.seoDescription,
          productCount: category._count.products,
          subcategories: category.children.map((child) => child.name),
          exampleProducts: category.products.map((product) => product.name),
        },
      });
    }
    return map;
  }
}

type EntityContext = {
  current: Record<string, unknown>;
  prompt: Record<string, unknown> & { id: string };
};
