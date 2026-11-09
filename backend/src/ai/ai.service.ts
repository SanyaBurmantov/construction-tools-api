import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
  cleanValue,
  formatBlock,
  diffAnswer,
  fieldDefs,
  FieldChange,
  isKnownField,
  parseAnswer,
  truncate,
  type ChatMessage,
} from './ai-fields';
import {
  lineInfo,
  repairMessage,
  repairNotes,
  SOURCE_KEYS,
  type RepairNote,
} from './ai-brief';
import { uniqueness } from '../ai-detector/uniqueness';
import {
  AiBrandFilterDto,
  AiBrandQueryDto,
  AiCategoryFilterDto,
  AiCategoryQueryDto,
  AiCreateTaskDto,
  AiExplainDto,
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
import { AiTemplateTextsService } from './ai-template-texts.service';
import { AI_CHECKS } from './ai-validate';
import { AiRewriteChecksService } from './ai-rewrite-checks.service';
import type { RewriteVerdict } from './ai-rewrite-checks';
import { AI_PRESETS, FIELD_GUIDE } from './ai-scaffolds';
import { PromptParts, quotedPhrases } from './ai-phrases';
import { VERIFY_SYSTEM_PROMPT } from './ai-verify';
import {
  AiTemplate,
  composeInstruction,
  InstructionBlock,
  instructionBlocks,
  PRODUCT_TEMPLATES,
  explainTemplate,
  productTemplate,
  templateKeywords,
} from './ai-templates';
import { Rejections, validateAnswer, ValidationInput } from './ai-validate';
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
  aiMayMoveProductUrl,
} from '../products/product-slug';
import {
  brandPath,
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
/** A description another one in the task covers this much of is flagged. */
const NEAR_DUPLICATE_SHARE = 0.6;

export type BatchOutcome = 'done' | 'progress' | 'rate-limited' | 'error';

/** The answer's fields that were asked for, nothing else. */
/**
 * The admin's part of an instruction, only for the fields the task writes:
 * a template's text for an unticked field must not leak into the prompt.
 */
function promptParts(
  general: string | null | undefined,
  fieldPrompts: Record<string, unknown> | null | undefined,
  fields: string[],
): PromptParts {
  const own: Record<string, string> = {};
  for (const key of fields) {
    const text = fieldPrompts?.[key];
    if (typeof text === 'string' && text.trim()) own[key] = text.trim();
  }
  return { general: general?.trim() || '', fields: own };
}

/** A non-product's SEO column is NOT NULL and defaults to the name. */
const NAME_DEFAULT_FIELDS = new Set(['seoTitle', 'seoDescription']);

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
    private readonly texts: AiTemplateTextsService,
    // Optional so the unit tests build the service without the catalogue.
    @Optional() private readonly rewriteChecks?: AiRewriteChecksService,
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
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      query.sort === 'new'
        ? [{ createdAt: 'desc' }, { id: 'asc' }]
        : query.sort === 'price_asc'
          ? [{ priceValue: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }]
          : query.sort === 'price_desc'
            ? [{ priceValue: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }]
            : [{ name: 'asc' }];
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          status: true,
          stockStatus: true,
          priceValue: true,
          createdAt: true,
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
            name: row.name.length,
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

  async listBrands(query: AiBrandQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = await this.brandWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          country: true,
          description: true,
          seoTitle: true,
          seoDescription: true,
        },
      }),
      this.prisma.brand.count({ where }),
    ]);
    // Counts for this page only — `_count` of Product in the list query
    // would group the whole catalogue (see CLAUDE.md, «Speed»).
    const counts = rows.length
      ? await this.prisma.product.groupBy({
          by: ['brandId'],
          where: {
            brandId: { in: rows.map((row) => row.id) },
            status: 'PUBLISHED',
          },
          _count: { _all: true },
        })
      : [];
    const byBrand = new Map(
      counts.map((row) => [row.brandId, row._count._all]),
    );
    return {
      data: rows.map(({ description, seoTitle, seoDescription, ...row }) => ({
        ...row,
        products: byBrand.get(row.id) ?? 0,
        lengths: {
          description: description?.length ?? 0,
          // The parser seeds both with the name: that is «not written».
          seoTitle: seoTitle && seoTitle !== row.name ? seoTitle.length : 0,
          seoDescription:
            seoDescription && seoDescription !== row.name
              ? seoDescription.length
              : 0,
        },
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  private async brandWhere(
    filter: AiBrandFilterDto,
  ): Promise<Prisma.BrandWhereInput> {
    const and: Prisma.BrandWhereInput[] = [];
    const search = filter.search?.trim();
    if (search) and.push({ name: { contains: search, mode: 'insensitive' } });
    if (filter.missing === 'description') {
      and.push({ OR: [{ description: null }, { description: '' }] });
    }
    if (filter.missing === 'seo') {
      // Still the parser's default (the name) — Prisma cannot compare two
      // columns, so the ids come from SQL; brands are a few hundred rows.
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Brand"
        WHERE "seoTitle" IN ('', name) OR "seoDescription" IN ('', name)`;
      and.push({ id: { in: rows.map((row) => row.id) } });
    }
    if (filter.withProducts === 'yes') {
      and.push({ products: { some: { status: 'PUBLISHED' } } });
    }
    return and.length ? { AND: and } : {};
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
    if (filter.ai?.startsWith('not:')) {
      and.push({ NOT: { aiLockedFields: { has: filter.ai.slice(4) } } });
    }
    if (filter.createdWithin) {
      const days = Number(filter.createdWithin);
      and.push({
        createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
      });
    }
    if (filter.image === 'yes') and.push({ images: { some: {} } });
    if (filter.image === 'no') and.push({ images: { none: {} } });
    const thin: Prisma.ProductWhereInput = {
      AND: [
        { OR: [{ descriptionFull: null }, { descriptionFull: '' }] },
        { OR: [{ descriptionShort: null }, { descriptionShort: '' }] },
        { productSpecs: { none: {} } },
      ],
    };
    if (filter.data === 'thin') and.push(thin);
    if (filter.data === 'rich') and.push({ NOT: thin });
    if (filter.priceMin !== undefined) {
      and.push({ priceValue: { gte: filter.priceMin } });
    }
    if (filter.priceMax !== undefined) {
      and.push({ priceValue: { lte: filter.priceMax } });
    }
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
    const fields = this.knownFields(dto.entity, dto.fields ?? []);
    const fieldTexts = this.fieldTexts(dto.entity, dto.fieldTexts);
    const text = dto.text?.trim() ?? '';
    if (!text && !Object.keys(fieldTexts).length) {
      throw new BadRequestException(
        'Напишите общую инструкцию или инструкцию хотя бы для одного поля',
      );
    }
    return this.prisma.aiPrompt.create({
      data: {
        name: dto.name.trim(),
        entity: dto.entity,
        text,
        fields,
        fieldTexts,
      },
    });
  }

  private knownFields(entity: AiEntity, keys: string[]) {
    return [...new Set(keys)].filter((key) => isKnownField(entity, key));
  }

  /** `{ field: text }` with unknown fields and blank texts dropped. */
  private fieldTexts(
    entity: AiEntity,
    raw: Record<string, unknown> | undefined,
  ) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (!isKnownField(entity, key) || typeof value !== 'string') continue;
      const text = value.trim().slice(0, 4000);
      if (text) out[key] = text;
    }
    return out;
  }

  async updatePrompt(id: string, dto: AiUpdatePromptDto) {
    const prompt = await this.ensurePrompt(id);
    return this.prisma.aiPrompt.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
        ...(dto.fields !== undefined
          ? { fields: this.knownFields(prompt.entity, dto.fields) }
          : {}),
        ...(dto.fieldTexts !== undefined
          ? { fieldTexts: this.fieldTexts(prompt.entity, dto.fieldTexts) }
          : {}),
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
   * The instruction a task or a preview sends, block by block: with
   * `templates` the shop rules (+ the kind's guide for a product), then what
   * the admin wrote — the general instruction and one per field.
   */
  private async instructionBlocks(
    entity: AiEntity,
    parts: PromptParts,
    fields: string[],
    templates: boolean | undefined,
    template: AiTemplate | null,
  ): Promise<InstructionBlock[]> {
    const blocks = instructionBlocks({
      entity,
      templates: Boolean(templates),
      template,
      parts,
      fields,
      // The admin's edited texts («Шаблоны») over the defaults.
      texts: templates ? await this.texts.effective() : {},
    });
    if (!blocks.length) {
      throw new BadRequestException(
        'Напишите общую инструкцию или инструкцию хотя бы для одного поля',
      );
    }
    return blocks;
  }

  private async instruction(
    entity: AiEntity,
    parts: PromptParts,
    fields: string[],
    templates: boolean | undefined,
    template: AiTemplate | null,
  ) {
    return composeInstruction(
      await this.instructionBlocks(entity, parts, fields, templates, template),
    );
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

    const parts = promptParts(dto.prompt, dto.fieldPrompts, fields);
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
      await Promise.all(
        [...groups].map(
          async ([key, group]) =>
            [
              key,
              await this.instruction(
                dto.entity,
                parts,
                fields,
                dto.templates,
                group.template,
              ),
            ] as const,
        ),
      ),
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
            promptParts: parts as Prisma.InputJsonValue,
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
      entity === AiEntity.PRODUCT
        ? AiProductFilterDto
        : entity === AiEntity.CATEGORY
          ? AiCategoryFilterDto
          : AiBrandFilterDto;
    const filter = plainToInstance(Dto, raw);
    const errors = validateSync(filter, { whitelist: true });
    if (errors.length) throw new BadRequestException('Некорректный фильтр');

    const take = MAX_TASK_ITEMS + 1;
    const select = { id: true } as const;
    const orderBy = { name: 'asc' } as const;
    const rows =
      entity === AiEntity.PRODUCT
        ? await this.prisma.product.findMany({
            where: await this.productWhere(filter),
            select,
            orderBy,
            take,
          })
        : entity === AiEntity.CATEGORY
          ? await this.prisma.category.findMany({
              where: await this.categoryWhere(filter as AiCategoryFilterDto),
              select,
              orderBy,
              take,
            })
          : await this.prisma.brand.findMany({
              where: await this.brandWhere(filter as AiBrandFilterDto),
              select,
              orderBy,
              take,
            });
    return rows.map((row) => row.id);
  }

  private entityNames(entity: AiEntity, ids: string[]) {
    const select = { id: true, name: true } as const;
    const where = { id: { in: ids } };
    if (entity === AiEntity.PRODUCT)
      return this.prisma.product.findMany({ where, select });
    if (entity === AiEntity.CATEGORY)
      return this.prisma.category.findMany({ where, select });
    return this.prisma.brand.findMany({ where, select });
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
        // Category and brand SEO columns are NOT NULL — fall back to the name.
        data[key] =
          changes[key].old ??
          (entity !== AiEntity.PRODUCT && NAME_DEFAULT_FIELDS.has(key)
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
    } else if (Object.keys(data).length && entity === AiEntity.CATEGORY) {
      await this.prisma.category.update({ where: { id }, data });
      await this.indexNow.enqueue([categoryPath(String(current.slug))]);
    } else if (Object.keys(data).length) {
      await this.prisma.brand.update({ where: { id }, data });
      await this.indexNow.enqueue([brandPath(String(current.slug))]);
    }
    return { skipped };
  }

  /* ---- «Отклонённое»: fields the checks refused ------------------------ */

  /**
   * Items with a refused field nobody has dealt with yet — what the admin's
   * «Отклонённое» compares (current value ↔ the model's text) and lets them
   * write by hand or dismiss.
   */
  async listRejected(query: { entity?: AiEntity; page?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = 20;
    const entity = query.entity ?? null;
    const open = Prisma.sql`
      FROM "AiTaskItem" i JOIN "AiTask" t ON t.id = i."taskId"
      WHERE i."rejected" IS NOT NULL
        AND (${entity}::text IS NULL OR t."entity"::text = ${entity}::text)
        AND EXISTS (
          SELECT 1 FROM jsonb_object_keys(i."rejected") AS k
          WHERE i."resolved" IS NULL OR NOT jsonb_exists(i."resolved", k))`;
    const [ids, counted] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT i.id ${open}
        ORDER BY i."updatedAt" DESC, i.id
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n ${open}`,
    ]);
    const items = await this.prisma.aiTaskItem.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: {
        task: {
          select: { id: true, name: true, entity: true, promptParts: true },
        },
      },
    });
    const order = new Map(ids.map((row, index) => [row.id, index]));
    items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const data = [];
    for (const item of items) {
      const rejected = (item.rejected ?? {}) as Record<string, string>;
      const resolved = (item.resolved ?? {}) as Record<string, string>;
      const keys = Object.keys(rejected).filter(
        (key) => !resolved[key] && isKnownField(item.task.entity, key),
      );
      const current = await this.currentValues(
        item.task.entity,
        item.entityId,
        keys,
      );
      const response = (item.response ?? {}) as Record<string, unknown>;
      const phrases = quotedPhrases(
        item.task.promptParts as PromptParts | null,
      );
      data.push({
        id: item.id,
        taskId: item.task.id,
        taskName: item.task.name,
        entity: item.task.entity,
        entityId: item.entityId,
        entityName: item.entityName,
        slug: current ? String(current.slug) : null,
        exists: Boolean(current),
        updatedAt: item.updatedAt,
        fields: keys.map((key) => {
          const def = fieldDefs(item.task.entity, [key])[0];
          const raw = response[key];
          return {
            key,
            label: def.label,
            maxLength: def.maxLength,
            reason: rejected[key],
            current:
              current && typeof current[key] === 'string' ? current[key] : null,
            proposed:
              cleanValue(def, raw, phrases) ??
              (typeof raw === 'string' ? raw : ''),
          };
        }),
      });
    }
    const total = Number(counted[0]?.n ?? 0);
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * The admin writes a refused field after all — the model's text as it was
   * or as they edited it. Recorded on the item like an AI change (so the
   * item's rollback covers it) and locked against the re-parse.
   */
  async applyRejected(itemId: string, field: string, value: string) {
    const item = await this.openRejected(itemId, field);
    const text = value.replace(/\r\n/g, '\n').trim();
    const def = fieldDefs(item.task.entity, [field])[0];
    if (!text) throw new BadRequestException('Пустой текст');
    if (text.length > def.maxLength) {
      throw new BadRequestException(`Не длиннее ${def.maxLength} символов`);
    }
    const announce: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.currentValues(
        item.task.entity,
        item.entityId,
        [field],
        tx,
      );
      if (!current) throw new NotFoundException('Запись удалена');
      const old = typeof current[field] === 'string' ? current[field] : null;
      const changes: Record<string, FieldChange> =
        old === text ? {} : { [field]: { old, new: text } };
      announce.push(
        ...(await this.applyChanges(
          item.task.entity,
          item.entityId,
          changes,
          current,
          tx,
        )),
      );
      await tx.aiTaskItem.update({
        where: { id: item.id },
        data: {
          changes: {
            ...((item.changes ?? {}) as Record<string, FieldChange>),
            ...changes,
          } as Prisma.InputJsonValue,
          status:
            Object.keys(changes).length &&
            item.status === AiTaskItemStatus.UNCHANGED
              ? AiTaskItemStatus.APPLIED
              : item.status,
          resolved: {
            ...((item.resolved ?? {}) as Record<string, string>),
            [field]: 'applied',
          },
        },
      });
    });
    await this.recount(item.taskId);
    await this.indexNow.enqueue(announce);
    return { ok: true };
  }

  /** «Оставить как есть»: the current text stays, the refused one leaves the list. */
  async dismissRejected(itemId: string, field: string) {
    const item = await this.openRejected(itemId, field);
    await this.prisma.aiTaskItem.update({
      where: { id: item.id },
      data: {
        resolved: {
          ...((item.resolved ?? {}) as Record<string, string>),
          [field]: 'dismissed',
        },
      },
    });
    return { ok: true };
  }

  private async openRejected(itemId: string, field: string) {
    const item = await this.prisma.aiTaskItem.findUnique({
      where: { id: itemId },
      include: { task: { select: { entity: true } } },
    });
    if (!item) throw new NotFoundException('Запись задачи не найдена');
    const rejected = (item.rejected ?? {}) as Record<string, string>;
    const resolved = (item.resolved ?? {}) as Record<string, string>;
    if (!rejected[field] || !isKnownField(item.task.entity, field)) {
      throw new BadRequestException('Это поле не отклонялось');
    }
    if (resolved[field]) throw new ConflictException('Уже разобрано');
    return item;
  }

  /* ---- Templates and checks («Шаблоны и проверки») -------------------- */

  /** Everything the tasks send and check, readable and editable. */
  async templates() {
    return {
      texts: await this.texts.list(),
      kinds: PRODUCT_TEMPLATES.map((template) => ({
        key: template.key,
        label: template.label,
        keywords: templateKeywords(template),
      })),
      checks: AI_CHECKS,
      verifyPrompt: VERIFY_SYSTEM_PROMPT,
      fieldGuide: FIELD_GUIDE,
      presets: AI_PRESETS,
    };
  }

  setTemplateText(id: string, text: string | null | undefined) {
    return this.texts.set(id, text);
  }

  /**
   * «Как соберётся запрос»: which kind's guide a record gets and why, the
   * instruction block by block (what is fixed, what comes from «Шаблоны»,
   * what the task adds) and the exact messages. No model call — free.
   */
  async explain(dto: AiExplainDto) {
    const contexts = await this.contexts(dto.entity, [dto.id]);
    const context = contexts.get(dto.id);
    if (!context) throw new NotFoundException('Запись не найдена');
    const templates = dto.templates ?? true;
    const choice =
      dto.entity === AiEntity.PRODUCT && templates
        ? explainTemplate(context.kind)
        : null;
    const keys = dto.fields?.length
      ? dto.fields
      : AI_FIELDS[dto.entity].map((field) => field.key);
    const fields = fieldDefs(dto.entity, keys);
    const parts = promptParts(dto.prompt, dto.fieldPrompts, keys);
    const blocks = await this.instructionBlocks(
      dto.entity,
      parts,
      keys,
      templates,
      choice?.template ?? null,
    );
    return {
      template: choice
        ? {
            key: choice.template.key,
            label: choice.template.label,
            by: choice.by,
            subject: choice.subject,
          }
        : null,
      blocks: [
        {
          kind: 'fixed',
          title: 'Формат ответа',
          text: formatBlock(dto.entity, fields),
        },
        ...blocks,
        {
          kind: 'data',
          title: 'Данные записи',
          text: JSON.stringify(context.prompt, null, 2),
        },
      ],
      phrases: quotedPhrases(parts),
      messages: buildMessages({
        entity: dto.entity,
        fields,
        instruction: composeInstruction(blocks),
        contexts: [context.prompt],
      }),
    };
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
    const keys = fields.map((field) => field.key);
    const parts = promptParts(dto.prompt, dto.fieldPrompts, keys);
    const phrases = quotedPhrases(parts);
    const instruction = await this.instruction(
      dto.entity,
      parts,
      keys,
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
      const first = parsed.get(dto.id) ?? [...parsed.values()][0] ?? {};
      // Exactly what a task does: checks, one repair, the meaning check.
      const repaired = await this.checkAndRepair({
        model,
        taskId: null,
        entity: dto.entity,
        fields,
        messages,
        answer: answer.content,
        records: new Map([[dto.id, first]]),
        contexts,
        phrases,
      });
      const record = repaired.records.get(dto.id) ?? first;
      const changes = diffAnswer(fields, context.current, record, phrases);
      const verdicts = await this.secondOpinion(
        model,
        null,
        fields,
        new Map([[dto.id, record]]),
        contexts,
        phrases,
      );
      const checked = repaired.checks.get(dto.id);
      const rejected: Rejections = {
        ...validateAnswer(
          { ...context.validation, allowed: phrases },
          newValues(changes),
        ),
        ...pickKeys(verdicts.get(dto.id) ?? {}, Object.keys(changes)),
        ...pickKeys(checked?.rejected ?? {}, Object.keys(changes)),
      };
      return {
        quality: checked?.quality ?? {},
        repairs: repaired.repairs,
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
        // The repair request is part of what this preview cost.
        usage: repaired.usage
          ? {
              promptTokens:
                answer.usage.promptTokens + repaired.usage.promptTokens,
              completionTokens:
                answer.usage.completionTokens + repaired.usage.completionTokens,
              cacheHitTokens:
                answer.usage.cacheHitTokens + repaired.usage.cacheHitTokens,
            }
          : answer.usage,
        phrases,
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

    // The admin's quoted phrases pass the cleaner and the checks verbatim.
    const phrases = quotedPhrases(task.promptParts as PromptParts | null);
    let records: Map<string, Record<string, unknown>>;
    let verdicts: Map<string, Rejections>;
    let checks: Map<string, RewriteVerdict>;
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
      // A field that fails is asked again once, with the reason, before it
      // is refused (`ai-brief.ts`); then the meaning check sees the final text.
      ({ records, checks } = await this.checkAndRepair({
        model: task.model,
        taskId: task.id,
        entity: task.entity,
        fields,
        messages,
        answer: answer.content,
        records,
        contexts,
        phrases,
      }));
      verdicts = await this.secondOpinion(
        task.model,
        task.id,
        fields,
        records,
        contexts,
        phrases,
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

    // Uniqueness and the detector's figure, outside the per-item transactions
    // (they read the catalogue and call the detector container).
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
          const proposed = diffAnswer(fields, current, record, phrases);
          const rejected: Rejections = {
            ...validateAnswer(
              { ...contexts.get(item.entityId)!.validation, allowed: phrases },
              newValues(proposed),
            ),
            ...pickKeys(
              verdicts.get(item.entityId) ?? {},
              Object.keys(proposed),
            ),
            ...pickKeys(
              checks.get(item.entityId)?.rejected ?? {},
              Object.keys(proposed),
            ),
          };
          const changes = withoutKeys(proposed, Object.keys(rejected));
          const warnings = await this.nearDuplicates(tx, task.id, changes);
          const quality = pickKeys(
            checks.get(item.entityId)?.quality ?? {},
            Object.keys(proposed),
          );
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
              quality: Object.keys(quality).length
                ? (quality as Prisma.InputJsonValue)
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
    phrases: string[] = [],
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
      const proposed = newValues(
        diffAnswer(checked, context.current, record, phrases),
      );
      const failed = validateAnswer(
        { ...context.validation, allowed: phrases },
        proposed,
      );
      const toCheck = withoutKeys(proposed, Object.keys(failed));
      if (Object.keys(toCheck).length) {
        inputs.push({ id, data: context.prompt, proposed: toCheck });
      }
    }
    if (!inputs.length) return verdicts;

    const answer = await this.client.chat(
      model,
      buildVerifyMessages(inputs, phrases),
    );
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
   * The code checks and the rewrite checks on a batch's answers; the fields
   * that fail are asked again once in the same conversation (the reason and
   * the copied pieces quoted, `ai-brief.ts`), and the repaired ones checked
   * again. The meaning check (`secondOpinion`) runs after, on the final text.
   * A failed repair request keeps the first answers — they are then refused
   * as before, never lost.
   */
  private async checkAndRepair(params: {
    model: string;
    taskId: string | null;
    entity: AiEntity;
    fields: ReturnType<typeof fieldDefs>;
    messages: ChatMessage[];
    answer: string;
    records: Map<string, Record<string, unknown>>;
    contexts: Map<string, EntityContext>;
    phrases: string[];
  }): Promise<{
    records: Map<string, Record<string, unknown>>;
    checks: Map<string, RewriteVerdict>;
    repairs: number;
    /** The repair request's tokens (a task bills them itself). */
    usage?: AiUsage;
  }> {
    const { fields, contexts, phrases } = params;
    const records = new Map(params.records);
    const checks = await this.checkRewrites(
      params.entity,
      fields,
      records,
      contexts,
      phrases,
    );
    const notes: RepairNote[] = [];
    for (const [id, record] of records) {
      const context = contexts.get(id);
      if (!context) continue;
      const proposed = newValues(
        diffAnswer(fields, context.current, record, phrases),
      );
      const rejected: Rejections = {
        ...validateAnswer(
          { ...context.validation, allowed: phrases },
          proposed,
        ),
        ...pickKeys(checks.get(id)?.rejected ?? {}, Object.keys(proposed)),
      };
      notes.push(...repairNotes(id, rejected, checks.get(id)?.copied));
    }
    if (!notes.length) return { records, checks, repairs: 0 };

    try {
      const second = await this.client.chat(params.model, [
        ...params.messages,
        { role: 'assistant', content: params.answer },
        { role: 'user', content: repairMessage(notes) },
      ]);
      if (params.taskId) await this.addUsage(params.taskId, second.usage);
      const answers = parseAnswer(second.content);
      const touched = new Map<string, Record<string, unknown>>();
      for (const note of notes) {
        const value = answers.get(note.id)?.[note.field];
        if (typeof value !== 'string' || !value.trim()) continue;
        const record = { ...(touched.get(note.id) ?? records.get(note.id)!) };
        record[note.field] = value;
        touched.set(note.id, record);
      }
      for (const [id, record] of touched) records.set(id, record);
      if (touched.size) {
        const again = await this.checkRewrites(
          params.entity,
          fields,
          touched,
          contexts,
          phrases,
        );
        for (const [id, verdict] of again) checks.set(id, verdict);
      }
      return { records, checks, repairs: touched.size, usage: second.usage };
    } catch (error) {
      if (error instanceof AiRateLimitError) throw error;
      this.logger.warn(`repair request failed: ${(error as Error).message}`);
      return { records, checks, repairs: 0 };
    }
  }

  /**
   * Uniqueness and detector figures for the descriptions in a batch's
   * answers (`ai-rewrite-checks.ts`). Never throws: without the checks
   * service (unit tests) or on its failure the batch is written as before.
   */
  private async checkRewrites(
    entity: AiEntity,
    fields: ReturnType<typeof fieldDefs>,
    records: Map<string, Record<string, unknown>>,
    contexts: Map<string, EntityContext>,
    phrases: string[],
  ): Promise<Map<string, RewriteVerdict>> {
    if (!this.rewriteChecks) return new Map();
    const inputs = [...records].flatMap(([entityId, record]) => {
      const context = contexts.get(entityId);
      if (!context) return [];
      const proposed = newValues(
        diffAnswer(fields, context.current, record, phrases),
      );
      return [
        {
          entityId,
          entity,
          proposed: Object.fromEntries(
            Object.entries(proposed).filter(([, v]) => typeof v === 'string'),
          ) as Record<string, string>,
          previous: Object.values(context.current).filter(
            (v): v is string => typeof v === 'string',
          ),
        },
      ];
    });
    try {
      return await this.rewriteChecks.check(inputs);
    } catch (error) {
      this.logger.warn(`rewrite checks failed: ${(error as Error).message}`);
      return new Map();
    }
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
        // The same shingles as the uniqueness figure: the share of this text
        // the other one covers.
        const score =
          (100 -
            (uniqueness(changes[key].new, [{ text: other.new, meta: null }])
              .percent ?? 100)) /
          100;
        if (score > best.score) best = { score, name: sibling.entityName };
      }
      if (best.score >= NEAR_DUPLICATE_SHARE) {
        warnings[key] =
          `почти как у «${best.name}» (${Math.round(best.score * 100)}%)`;
      }
    }
    return warnings;
  }

  /**
   * Writes the accepted changes; returns the storefront paths to announce.
   * A new name moves a never-published product's URL (`slugFromName`,
   * `aiMayMoveProductUrl`), with a 301 left on the old one; the move is
   * recorded in `changes.slug`, so reverting the item moves it back.
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
      // Only a never-published product's URL follows the new name, and only
      // once (see aiMayMoveProductUrl): a public address keeps its indexing.
      if (changes.name && aiMayMoveProductUrl(current)) {
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
    if (entity === AiEntity.CATEGORY) {
      await db.category.update({ where: { id }, data });
      return [categoryPath(String(current.slug))];
    }
    await db.brand.update({ where: { id }, data });
    return [brandPath(String(current.slug))];
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
        select: {
          ...select,
          aiLockedFields: true,
          lockedFields: true,
          status: true,
        },
      }) as Promise<Record<string, unknown> | null>;
    }
    if (entity === AiEntity.CATEGORY) {
      return db.category.findUnique({
        where: { id },
        select,
      }) as Promise<Record<string, unknown> | null>;
    }
    return db.brand.findUnique({
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
      const lines = await this.productLines(products.map((p) => p.id));
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
            // a model shown them writes them anyway. The prose it may rewrite
            // travels as a source, not under the field's name (`ai-brief.ts`).
            [SOURCE_KEYS.descriptionShort]: product.descriptionShort,
            [SOURCE_KEYS.descriptionFull]: shownDescription,
            ...(lines.get(product.id) ? { line: lines.get(product.id) } : {}),
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

    if (entity === AiEntity.BRAND) {
      await this.brandContexts(ids, map);
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
          [SOURCE_KEYS.description]: shown,
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

  /**
   * Each product's place in its size line (`ai-brief.ts lineInfo`): its
   * family's published siblings, by the name sizes are read from.
   */
  private async productLines(ids: string[]) {
    const out = new Map<string, ReturnType<typeof lineInfo>>();
    const own = await this.prisma.productFamily.findMany({
      where: { productId: { in: ids }, familyKey: { not: null } },
      select: {
        productId: true,
        familyKey: true,
        keyName: true,
        product: { select: { name: true } },
      },
    });
    if (!own.length) return out;
    const siblings = await this.prisma.productFamily.findMany({
      where: {
        familyKey: { in: [...new Set(own.map((f) => f.familyKey!))] },
        product: { status: 'PUBLISHED' },
      },
      select: {
        productId: true,
        familyKey: true,
        keyName: true,
        product: { select: { name: true } },
      },
      take: 500,
    });
    for (const f of own) {
      const names = siblings
        .filter(
          (s) => s.familyKey === f.familyKey && s.productId !== f.productId,
        )
        .map((s) => s.keyName || s.product.name);
      out.set(f.productId, lineInfo(f.keyName || f.product.name, names));
    }
    return out;
  }

  /**
   * A brand's page lists the categories it has published products in, so
   * that is what the model is shown: those categories (biggest first) and a
   * handful of its product names — the facts a brand text may use.
   */
  private async brandContexts(ids: string[], map: Map<string, EntityContext>) {
    const brands = await this.prisma.brand.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        slug: true,
        country: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
      },
    });
    for (const brand of brands) {
      const [byCategory, examples, total] = await Promise.all([
        this.prisma.product.groupBy({
          by: ['categoryId'],
          where: { brandId: brand.id, status: 'PUBLISHED' },
          _count: { _all: true },
          orderBy: { _count: { categoryId: 'desc' } },
          take: 15,
        }),
        this.prisma.product.findMany({
          where: { brandId: brand.id, status: 'PUBLISHED' },
          select: { name: true },
          orderBy: { listingRank: 'desc' },
          take: 10,
        }),
        this.prisma.product.count({
          where: { brandId: brand.id, status: 'PUBLISHED' },
        }),
      ]);
      const names = new Map(
        (
          await this.prisma.category.findMany({
            where: {
              id: { in: byCategory.map((row) => row.categoryId) },
              isVisible: true,
            },
            select: { id: true, name: true },
          })
        ).map((row) => [row.id, row.name]),
      );
      const categories = byCategory
        .map((row) => names.get(row.categoryId))
        .filter((name): name is string => Boolean(name));
      // The parser seeds the SEO fields with the name: not a text to show.
      const own = (value: string | null) =>
        value && value !== brand.name ? value : null;
      const shown = truncate(brand.description, DESCRIPTION_CONTEXT_CHARS);
      map.set(brand.id, {
        current: brand as unknown as Record<string, unknown>,
        kind: { name: brand.name, categoryPath: '' },
        validation: {
          entity: AiEntity.BRAND,
          oldName: brand.name,
          source: [
            brand.name,
            brand.country,
            shown,
            own(brand.seoTitle),
            own(brand.seoDescription),
            String(total),
            ...categories,
            ...examples.map((product) => product.name),
          ]
            .filter(Boolean)
            .join('\n'),
        },
        prompt: {
          id: brand.id,
          name: brand.name,
          country: brand.country,
          [SOURCE_KEYS.description]: shown,
          seoTitle: own(brand.seoTitle),
          seoDescription: own(brand.seoDescription),
          productCount: total,
          categories,
          exampleProducts: examples.map((product) => product.name),
        },
      });
    }
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
