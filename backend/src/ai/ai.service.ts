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
import { AiClient, AiRateLimitError, AiUsage } from './ai.client';
import {
  AiTemplate,
  categoryInstruction,
  productInstruction,
  productTemplate,
} from './ai-templates';
import {
  NEAR_DUPLICATE_SIMILARITY,
  Rejections,
  textSimilarity,
  validateAnswer,
  ValidationInput,
} from './ai-validate';
import {
  buildVerifyMessages,
  parseVerifyAnswer,
  VERIFIED_FIELDS,
  VerifyInput,
} from './ai-verify';
import {
  freeProductSlug,
  redirectOldSlug,
  isProductSlugFree,
  slugFromName,
} from '../products/product-slug';
import {
  categoryPath,
  IndexNowService,
  productPath,
} from '../seo/indexnow.service';

/** A batch that fails this many times marks its items FAILED for good. */
const MAX_ATTEMPTS = 3;
const SPEC_LIMIT = 25;
const DESCRIPTION_CONTEXT_CHARS = 2500;
/** How many of a task's written items a new description is compared with. */
const NEAR_DUPLICATE_LOOKBACK = 300;

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
    private readonly client: AiClient,
    private readonly indexNow: IndexNowService,
  ) {}

  /* ---- Status ---------------------------------------------------------- */

  async status() {
    const [quota, active] = await Promise.all([
      this.client.quota(),
      this.prisma.aiTask.count({
        where: { status: { in: [AiTaskStatus.QUEUED, AiTaskStatus.RUNNING] } },
      }),
    ]);
    return {
      enabled: this.client.enabled,
      provider: this.client.providerLabel,
      defaultModel: this.client.defaultModel,
      quota,
      activeTasks: active,
      fields: AI_FIELDS,
    };
  }

  models() {
    return this.client.models();
  }

  /** A task names a model the current provider serves, or none (= default). */
  private assertModel(model: string | undefined) {
    const id = model?.trim();
    if (id && !this.client.allowsModel(id)) {
      throw new BadRequestException(
        `Модель ${id} недоступна: у DeepSeek — deepseek-*, у OpenRouter — только бесплатные (:free)`,
      );
    }
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

  /**
   * The instruction a task or a preview sends: the admin's own prompt, or —
   * with `templates` — the built-in rules (+ the kind's guide for a product)
   * with the admin's text added at the end.
   */
  private instruction(
    entity: AiEntity,
    prompt: string | undefined,
    templates: boolean | undefined,
    template: AiTemplate | null,
  ) {
    if (templates) {
      return entity === AiEntity.PRODUCT && template
        ? productInstruction(template, prompt)
        : categoryInstruction(prompt);
    }
    if (!prompt?.trim()) throw new BadRequestException('Напишите промпт');
    return prompt.trim();
  }

  async createTask(dto: AiCreateTaskDto, createdBy: string | null) {
    const fields = [...new Set(dto.fields)];
    const unknown = fields.filter((key) => !isKnownField(dto.entity, key));
    if (unknown.length) {
      throw new BadRequestException(
        `Поле нельзя обновлять: ${unknown.join(', ')}`,
      );
    }
    if (dto.promptId) await this.ensurePrompt(dto.promptId);
    this.assertModel(dto.model);

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

    // With templates every kind of product gets its own task — one prompt
    // per request, so a batch never mixes an anchor with a hammer drill.
    const groups = new Map<
      string,
      { template: AiTemplate | null; entities: typeof entities }
    >();
    if (dto.templates && dto.entity === AiEntity.PRODUCT) {
      const kinds = await this.productKinds(
        entities.map((entity) => entity.id),
      );
      for (const entity of entities) {
        const template = productTemplate(
          kinds.get(entity.id) ?? { name: entity.name, categoryPath: '' },
        );
        const group = groups.get(template.key) ?? { template, entities: [] };
        group.entities.push(entity);
        groups.set(template.key, group);
      }
    } else {
      groups.set('', { template: null, entities });
    }
    // Validates the prompt before anything is written.
    const instructions = new Map(
      [...groups].map(([key, group]) => [
        key,
        this.instruction(dto.entity, dto.prompt, dto.templates, group.template),
      ]),
    );

    const tasks = await this.prisma.$transaction(async (tx) => {
      const created: AiTask[] = [];
      for (const [key, group] of groups) {
        const task = await tx.aiTask.create({
          data: {
            name:
              groups.size > 1 && group.template
                ? `${dto.name.trim()} — ${group.template.label}`
                : dto.name.trim(),
            entity: dto.entity,
            fields,
            promptId: dto.promptId ?? null,
            promptText: instructions.get(key)!,
            model: dto.model?.trim() || this.client.defaultModel,
            batchSize: dto.batchSize ?? 5,
            scheduledAt: dto.scheduledAt
              ? new Date(dto.scheduledAt)
              : new Date(),
            total: group.entities.length,
            createdBy,
          },
        });
        await tx.aiTaskItem.createMany({
          data: group.entities.map((entity) => ({
            taskId: task.id,
            entityId: entity.id,
            entityName: entity.name,
          })),
        });
        created.push(task);
      }
      return created;
    });
    return {
      ...tasks[0],
      tasks: tasks.map((task) => ({
        id: task.id,
        name: task.name,
        total: task.total,
      })),
    };
  }

  /** Name + category chain per product — what picks its template. */
  private async productKinds(ids: string[]) {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        category: {
          select: {
            name: true,
            parent: {
              select: { name: true, parent: { select: { name: true } } },
            },
          },
        },
      },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          name: row.name,
          categoryPath: [
            row.category.parent?.parent?.name,
            row.category.parent?.name,
            row.category.name,
          ]
            .filter(Boolean)
            .join(' / '),
        },
      ]),
    );
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
      const aiSlug = String(current.slug);
      const oldSlug = data.slug;
      // The old URL goes back only if nobody took it meanwhile.
      if (oldSlug && !(await isProductSlugFree(this.prisma, oldSlug, id))) {
        delete data.slug;
        skipped++;
      }
      // Unlock only what was actually restored. A skipped field holds a newer
      // AI task's text or an admin's edit; unlocking it let the next re-parse
      // put the supplier text back over that work.
      const restored = Object.keys(data);
      const locked = ((current.aiLockedFields as string[]) ?? []).filter(
        (key) => !restored.includes(key),
      );
      const slug = data.slug ?? aiSlug;
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            ...data,
            aiLockedFields: locked,
            ...(restored.length ? { contentUpdatedAt: new Date() } : {}),
          },
        });
        if (slug !== aiSlug) await redirectOldSlug(tx, id, aiSlug, slug);
      });
      if (restored.length) {
        await this.indexNow.enqueue([
          productPath(slug),
          slug !== aiSlug ? productPath(aiSlug) : null,
        ]);
      }
    } else if (Object.keys(data).length) {
      await this.prisma.category.update({ where: { id }, data });
      await this.indexNow.enqueue([categoryPath(String(current.slug))]);
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

    const template =
      dto.templates && dto.entity === AiEntity.PRODUCT
        ? productTemplate(context.kind)
        : null;
    const instruction = this.instruction(
      dto.entity,
      dto.prompt,
      dto.templates,
      template,
    );
    const messages = buildMessages({
      entity: dto.entity,
      fields,
      instruction,
      contexts: [context.prompt],
    });
    this.assertModel(dto.model);
    const model = dto.model || this.client.defaultModel;
    try {
      const answer = await this.client.chat(model, messages);
      const parsed = parseAnswer(answer.content);
      const record = parsed.get(dto.id) ?? [...parsed.values()][0] ?? {};
      const changes = diffAnswer(fields, context.current, record);
      // The same two checks a task runs, so the preview shows what it would write.
      const verdicts = await this.secondOpinion(
        model,
        null,
        fields,
        new Map([[dto.id, record]]),
        contexts,
      );
      const rejected: Rejections = {
        ...validateAnswer(context.validation, newValues(changes)),
        ...pickKeys(verdicts.get(dto.id) ?? {}, Object.keys(changes)),
      };
      return {
        model: answer.model,
        template: template?.label ?? null,
        // What a task would write: the rejected fields stay as they are.
        changes: withoutKeys(changes, Object.keys(rejected)),
        rejected: Object.fromEntries(
          Object.entries(rejected).map(([key, reason]) => [
            key,
            { reason, value: changes[key].new },
          ]),
        ),
        usage: answer.usage,
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
   * A rate limit (or an empty balance) is per *key*, not per task. Remembered here so the
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

    let records: Map<string, Record<string, unknown>>;
    let verdicts: Map<string, Rejections>;
    try {
      const answer = await this.client.chat(task.model, messages);
      // Billed whether or not the answer parses.
      await this.addUsage(task.id, answer.usage);
      const answers = parseAnswer(answer.content);
      // A single-item batch whose answer came back with a mangled id is still
      // unambiguous.
      const lone =
        items.length === 1 && answers.size === 1
          ? [...answers.values()][0]
          : null;
      records = new Map();
      for (const item of items) {
        const record = answers.get(item.entityId) ?? lone;
        if (record) records.set(item.entityId, record);
      }
      verdicts = await this.secondOpinion(
        task.model,
        task.id,
        fields,
        records,
        contexts,
      );
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

    const announce: Array<string | null> = [];
    for (const item of items) {
      const record = records.get(item.entityId);
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
          // What the checks refuse is not written; the old text stays.
          const proposed = diffAnswer(fields, current, record);
          const rejected: Rejections = {
            ...validateAnswer(
              contexts.get(item.entityId)!.validation,
              newValues(proposed),
            ),
            ...pickKeys(
              verdicts.get(item.entityId) ?? {},
              Object.keys(proposed),
            ),
          };
          const changes = withoutKeys(proposed, Object.keys(rejected));
          const warnings = await this.nearDuplicates(tx, task.id, changes);
          const paths = await this.applyChanges(
            task.entity,
            item.entityId,
            changes,
            current,
            tx,
          );
          announce.push(...paths);
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
              rejected: Object.keys(rejected).length
                ? (rejected as Prisma.InputJsonValue)
                : Prisma.DbNull,
              warnings: Object.keys(warnings).length
                ? (warnings as Prisma.InputJsonValue)
                : Prisma.DbNull,
              error: null,
            },
          });
        });
      } catch (error) {
        await this.chargeAttempt([item], (error as Error).message);
      }
    }
    await this.indexNow.enqueue(announce);
    return 'progress';
  }

  private async addUsage(taskId: string, usage: AiUsage) {
    await this.prisma.aiTask.update({
      where: { id: taskId },
      data: {
        promptTokens: { increment: usage.promptTokens },
        completionTokens: { increment: usage.completionTokens },
        cacheHitTokens: { increment: usage.cacheHitTokens },
      },
    });
  }

  /**
   * The verifier's objections, per entity: field → problem. Checks only the
   * fields that passed the code checks (no point paying to re-check a field
   * that is rejected anyway) and only `VERIFIED_FIELDS`. Throws when the
   * verifier does not answer — the batch is then retried, rather than a name
   * written that nobody checked. `AI_VERIFY=false` turns it off.
   */
  private async secondOpinion(
    model: string,
    taskId: string | null,
    fields: ReturnType<typeof fieldDefs>,
    records: Map<string, Record<string, unknown>>,
    contexts: Map<string, EntityContext>,
  ): Promise<Map<string, Rejections>> {
    const verdicts = new Map<string, Rejections>();
    if (process.env.AI_VERIFY?.trim() === 'false') return verdicts;
    const checked = fields.filter((field) =>
      (VERIFIED_FIELDS as readonly string[]).includes(field.key),
    );
    if (!checked.length) return verdicts;

    const inputs: VerifyInput[] = [];
    for (const [id, record] of records) {
      const context = contexts.get(id);
      if (!context || context.validation.entity !== AiEntity.PRODUCT) continue;
      const proposed = newValues(diffAnswer(checked, context.current, record));
      const failed = validateAnswer(context.validation, proposed);
      const toCheck = withoutKeys(proposed, Object.keys(failed));
      if (Object.keys(toCheck).length) {
        inputs.push({ id, data: context.prompt, proposed: toCheck });
      }
    }
    if (!inputs.length) return verdicts;

    const answer = await this.client.chat(model, buildVerifyMessages(inputs));
    if (taskId) await this.addUsage(taskId, answer.usage);
    for (const [id, problems] of parseVerifyAnswer(
      parseAnswer(answer.content),
    )) {
      verdicts.set(
        id,
        Object.fromEntries(
          Object.entries(problems).map(([field, problem]) => [
            field,
            `проверка смысла: ${problem}`,
          ]),
        ),
      );
    }
    return verdicts;
  }

  /**
   * Flags a description that is a near-copy of one this task already wrote —
   * the variants of one line (sizes, packs) tend to come out the same, and a
   * search engine shows one of a set of near-identical pages. A flag, not a
   * rejection: the supplier text it replaces is just as duplicated.
   */
  private async nearDuplicates(
    db: Prisma.TransactionClient,
    taskId: string,
    changes: Record<string, FieldChange>,
  ) {
    const warnings: Record<string, string> = {};
    const keys = ['descriptionFull', 'descriptionShort', 'description'].filter(
      (key) => changes[key],
    );
    if (!keys.length) return warnings;
    const siblings = await db.aiTaskItem.findMany({
      where: { taskId, status: AiTaskItemStatus.APPLIED },
      select: { entityName: true, changes: true },
      orderBy: { updatedAt: 'desc' },
      take: NEAR_DUPLICATE_LOOKBACK,
    });
    for (const key of keys) {
      let best = { score: 0, name: '' };
      for (const sibling of siblings) {
        const other = (sibling.changes as Record<string, FieldChange> | null)?.[
          key
        ];
        if (!other) continue;
        const score = textSimilarity(changes[key].new, other.new);
        if (score > best.score) best = { score, name: sibling.entityName };
      }
      if (best.score >= NEAR_DUPLICATE_SIMILARITY) {
        warnings[key] =
          `почти как у «${best.name}» (${Math.round(best.score * 100)}%)`;
      }
    }
    return warnings;
  }

  /**
   * Writes the accepted changes; returns the storefront paths to announce.
   * A new product name also moves the URL (`slugFromName`), with a 301 left
   * on the old one; the move is recorded in `changes.slug`, so reverting the
   * item moves it back.
   */
  private async applyChanges(
    entity: AiEntity,
    id: string,
    changes: Record<string, FieldChange>,
    current: Record<string, unknown>,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string[]> {
    const keys = Object.keys(changes);
    if (!keys.length) return [];
    const data: Record<string, unknown> = Object.fromEntries(
      keys.map((key) => [key, changes[key].new]),
    );

    if (entity === AiEntity.PRODUCT) {
      const oldSlug = String(current.slug);
      let newSlug = oldSlug;
      // The URL moves once. After an AI rename (or an admin's hand-set slug)
      // it is ours; a later rewrite of the name keeps it, or every re-run of
      // a task would leave the page at yet another address.
      const urlIsOurs = [
        ...((current.aiLockedFields as string[]) ?? []),
        ...((current.lockedFields as string[]) ?? []),
      ].includes('slug');
      if (changes.name && !urlIsOurs) {
        const base = slugFromName(changes.name.new);
        const free =
          base && base !== oldSlug ? await freeProductSlug(db, base, id) : null;
        if (free && free !== oldSlug) {
          newSlug = free;
          data.slug = free;
          changes.slug = { old: oldSlug, new: free };
        }
      }
      // Lock what was written, or tomorrow's re-parse puts the supplier's
      // text back (see ProductIdentityService.save). A parser never writes
      // the slug; its lock marks the URL as ours (see above), and a revert
      // that restores the old one drops it.
      const locked = new Set([
        ...((current.aiLockedFields as string[]) ?? []),
        ...keys,
        ...(newSlug !== oldSlug ? ['slug'] : []),
      ]);
      await db.product.update({
        where: { id },
        data: {
          ...data,
          aiLockedFields: [...locked],
          contentUpdatedAt: new Date(),
        },
      });
      if (newSlug !== oldSlug) await redirectOldSlug(db, id, oldSlug, newSlug);
      return [
        productPath(newSlug),
        newSlug !== oldSlug ? productPath(oldSlug) : '',
      ].filter(Boolean);
    }
    await db.category.update({ where: { id }, data });
    return [categoryPath(String(current.slug))];
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
      [...keys, 'name', 'slug'].map((key) => [key, true]),
    );
    if (entity === AiEntity.PRODUCT) {
      return db.product.findUnique({
        where: { id },
        select: { ...select, aiLockedFields: true, lockedFields: true },
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
        const specs = product.productSpecs.map(
          (spec) => `${spec.specification.name}: ${spec.value}`,
        );
        const shownDescription = truncate(
          product.descriptionFull,
          DESCRIPTION_CONTEXT_CHARS,
        );
        map.set(product.id, {
          current: product as unknown as Record<string, unknown>,
          kind: { name: product.name, categoryPath: category.join(' / ') },
          validation: {
            entity: AiEntity.PRODUCT,
            oldName: product.name,
            brand: product.brand?.name ?? null,
            thin:
              !product.descriptionFull?.trim() &&
              !product.descriptionShort?.trim() &&
              specs.length < 3,
            source: [
              product.name,
              product.brand?.name,
              category.join(' / '),
              product.sku,
              product.model,
              product.descriptionShort,
              shownDescription,
              product.seoTitle,
              product.seoDescription,
              ...specs,
            ]
              .filter(Boolean)
              .join('\n'),
          },
          prompt: {
            id: product.id,
            name: product.name,
            brand: product.brand?.name ?? null,
            category: category.join(' / '),
            sku: product.sku,
            model: product.model,
            // No price and no stock: the rules forbid both in the text, and
            // a model shown them writes them anyway.
            descriptionShort: product.descriptionShort,
            descriptionFull: shownDescription,
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
      const parents = [category.parent?.parent?.name, category.parent?.name]
        .filter(Boolean)
        .join(' / ');
      const shown = truncate(category.description, DESCRIPTION_CONTEXT_CHARS);
      map.set(category.id, {
        current: category as unknown as Record<string, unknown>,
        kind: { name: category.name, categoryPath: parents },
        validation: {
          entity: AiEntity.CATEGORY,
          oldName: category.name,
          source: [
            category.name,
            parents,
            shown,
            category.seoTitle,
            category.seoDescription,
            ...category.children.map((child) => child.name),
            ...category.products.map((product) => product.name),
          ]
            .filter(Boolean)
            .join('\n'),
        },
        prompt: {
          id: category.id,
          name: category.name,
          parents,
          description: shown,
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
  /** What picks the product template. */
  kind: { name: string; categoryPath: string };
  /** What the answer is checked against (`ai-validate.ts`). */
  validation: ValidationInput;
};

function newValues(changes: Record<string, FieldChange>) {
  return Object.fromEntries(
    Object.entries(changes).map(([key, change]) => [key, change.new]),
  );
}

function withoutKeys<T>(record: Record<string, T>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );
}

function pickKeys<T>(record: Record<string, T>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => keys.includes(key)),
  );
}
