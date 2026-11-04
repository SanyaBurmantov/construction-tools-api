import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AiEntity,
  AiSuggestion,
  AiSuggestionKind,
  AiSuggestionStatus,
  AiTaskStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClient, AiRateLimitError } from '../ai.client';
import type { ChatMessage } from '../ai-fields';
import { AiService } from '../ai.service';
import { AI_PRESETS } from '../ai-scaffolds';
import { nameHead } from '../ai-templates';
import { OffersService } from '../../offers/offers.service';
import { IndexNowService } from '../../seo/indexnow.service';
import { FALLBACK_CATEGORY_SLUG } from '../../common/constants/catalog';
import {
  buildFtsQuery,
  cleanSynonymGroups,
  FTS_DOCUMENT_SQL,
} from '../../products/search-fts';
import { SEARCH_SYNONYMS_SETTING } from '../../products/products.service';
import {
  addSpecAliases,
  parseSpecAliases,
  SPEC_ALIASES_SETTING,
} from '../../catalog-normalizer/spec-aliases';
import {
  ASSIST_JOB_INFO,
  ASSIST_JOBS,
  AssistJob,
  AssistJobSettings,
  assistDay,
  mergeJobSettings,
} from './assist-jobs';
import {
  buildCategorizeMessages,
  buildDuplicateMessages,
  buildLandingMessages,
  buildLeadMessages,
  buildSpecMessages,
  buildSynonymMessages,
  buildVariantMessages,
  CategorizeItem,
  DuplicateGroupInput,
  LandingInput,
  LeadCandidate,
  parseCategorizeAnswer,
  parseDuplicateAnswer,
  parseLandingAnswer,
  parseLeadAnswer,
  parseSpecAnswer,
  parseSynonymAnswer,
  parseVariantAnswer,
  SpecGroupInput,
} from './assist-prompts';

const SETTINGS_PREFIX = 'ai.assist.';
const USAGE_PREFIX = 'ai.assist.usage.';
/** Who an assistant's own action is recorded as. */
export const ASSIST_ACTOR = 'ИИ-помощник';
/** Below this many published products a brand+category gets no landing. */
export const LANDING_MIN_PRODUCTS = 6;
/** Per request — small, so one bad answer costs little. */
const CATEGORIZE_BATCH = 5;
const SYNONYM_BATCH = 20;
const LANDING_BATCH = 3;
const DUPLICATE_BATCH = 5;
const VARIANT_GROUP_MAX = 40;
/** What «the AI has written this product's texts» means for the autopilot. */
const AUTOPILOT_TEXT_FIELDS = [
  'name',
  'descriptionShort',
  'descriptionFull',
  'seoTitle',
  'seoDescription',
];

export type StepResult = {
  /** `idle`: nothing to do (the job rests); `limit`: today's limit is spent. */
  result: 'done' | 'idle' | 'limit' | 'off' | 'error' | 'rate-limited';
  /** Items handled (products, terms, leads…). */
  items: number;
  note?: string;
};

type Usage = {
  day: string;
  items: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  lastRunAt?: string;
  lastResult?: string;
  /** Job-specific position (the spec job's last root category). */
  cursor?: string;
};

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

/**
 * The AI assistant: DeepSeek as a worker inside the shop (see assist-jobs.ts
 * for the list and what each job may do alone). One `step(job)` is one
 * request's worth of work; `AiAssistCron` calls it in the worker, «Запустить
 * сейчас» in the admin calls it in the API. Every model choice goes through
 * the pure parsers in assist-prompts.ts — the model picks among what it was
 * given, never anything else.
 */
@Injectable()
export class AiAssistService {
  private readonly logger = new Logger(AiAssistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AiClient,
    private readonly ai: AiService,
    private readonly offers: OffersService,
    private readonly indexNow: IndexNowService,
  ) {}

  /* ---- Settings and the day's usage --------------------------------------- */

  async settings(job: AssistJob): Promise<AssistJobSettings> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: SETTINGS_PREFIX + job },
    });
    return mergeJobSettings(job, row ? safeJson(row.value) : null);
  }

  async updateSettings(job: AssistJob, patch: Partial<AssistJobSettings>) {
    const next = mergeJobSettings(job, {
      ...(await this.settings(job)),
      ...patch,
    });
    await this.prisma.siteSetting.upsert({
      where: { key: SETTINGS_PREFIX + job },
      create: { key: SETTINGS_PREFIX + job, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    return next;
  }

  private async usage(job: AssistJob): Promise<Usage> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: USAGE_PREFIX + job },
    });
    const stored = (row ? safeJson(row.value) : null) as Usage | null;
    const day = assistDay();
    if (!stored || stored.day !== day) {
      return {
        day,
        items: 0,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        lastRunAt: stored?.lastRunAt,
        lastResult: stored?.lastResult,
        cursor: stored?.cursor,
      };
    }
    return stored;
  }

  private async saveUsage(job: AssistJob, usage: Usage) {
    await this.prisma.siteSetting.upsert({
      where: { key: USAGE_PREFIX + job },
      create: { key: USAGE_PREFIX + job, value: JSON.stringify(usage) },
      update: { value: JSON.stringify(usage) },
    });
  }

  /** Every job with its switch, limit, today's usage and pending proposals — the admin screen. */
  async overview() {
    const [pending, applied] = await Promise.all([
      this.prisma.aiSuggestion.groupBy({
        by: ['kind'],
        where: { status: AiSuggestionStatus.PENDING },
        _count: { _all: true },
      }),
      this.prisma.aiSuggestion.count({
        where: {
          kind: AiSuggestionKind.CATEGORY,
          status: AiSuggestionStatus.APPLIED,
          auto: true,
        },
      }),
    ]);
    const landings = await this.prisma.brandCategoryLanding.groupBy({
      by: ['isPublished'],
      _count: { _all: true },
    });
    const jobs = [];
    for (const job of ASSIST_JOBS) {
      const info = ASSIST_JOB_INFO[job];
      jobs.push({
        key: job,
        title: info.title,
        description: info.description,
        unit: info.unit,
        settings: await this.settings(job),
        usage: await this.usage(job),
      });
    }
    return {
      enabled: this.client.enabled,
      jobs,
      pending: Object.fromEntries(
        pending.map((row) => [row.kind, row._count._all]),
      ),
      autoAppliedCategories: applied,
      landings: {
        published: landings.find((row) => row.isPublished)?._count._all ?? 0,
        unpublished: landings.find((row) => !row.isPublished)?._count._all ?? 0,
      },
      presets: AI_PRESETS.filter(
        (preset) => preset.entity === AiEntity.PRODUCT,
      ).map((preset) => ({ id: preset.id, title: preset.title })),
    };
  }

  /* ---- The model ------------------------------------------------------------ */

  /** The key is paused for every job after a 429 or an empty balance. */
  pausedUntil: Date | null = null;

  private async ask(job: AssistJob, usage: Usage, messages: ChatMessage[]) {
    const answer = await this.client.chat(this.client.defaultModel, messages);
    usage.requests += 1;
    usage.promptTokens += answer.usage.promptTokens;
    usage.completionTokens += answer.usage.completionTokens;
    return answer;
  }

  /**
   * One step of a job: at most one request to the model. Never throws — the
   * outcome is returned and recorded as the job's last result.
   */
  async step(
    job: AssistJob,
    options: { force?: boolean } = {},
  ): Promise<StepResult> {
    const settings = await this.settings(job);
    if (!settings.enabled && !options.force) return { result: 'off', items: 0 };
    if (!this.client.enabled) {
      return { result: 'off', items: 0, note: 'Нет ключа ИИ' };
    }
    if (this.pausedUntil && this.pausedUntil > new Date()) {
      return { result: 'rate-limited', items: 0, note: 'Лимит ключа' };
    }
    const usage = await this.usage(job);
    const left = settings.daily - usage.items;
    if (left <= 0)
      return this.record(job, usage, { result: 'limit', items: 0 });

    let outcome: StepResult;
    try {
      outcome = await this.run(job, settings, usage, left);
    } catch (error) {
      if (error instanceof AiRateLimitError) {
        this.pausedUntil = error.retryAt;
        outcome = { result: 'rate-limited', items: 0, note: error.message };
      } else {
        this.logger.warn(`AI assist ${job}: ${(error as Error).message}`);
        outcome = {
          result: 'error',
          items: 0,
          note: (error as Error).message.slice(0, 300),
        };
      }
    }
    usage.items += outcome.items;
    return this.record(job, usage, outcome);
  }

  private async record(job: AssistJob, usage: Usage, outcome: StepResult) {
    usage.lastRunAt = new Date().toISOString();
    usage.lastResult = [outcome.result, outcome.note]
      .filter(Boolean)
      .join(': ');
    await this.saveUsage(job, usage);
    return outcome;
  }

  private run(
    job: AssistJob,
    settings: AssistJobSettings,
    usage: Usage,
    left: number,
  ): Promise<StepResult> {
    switch (job) {
      case 'autopilot':
        return this.autopilot(settings, left);
      case 'categorize':
        return this.categorize(usage, left);
      case 'synonyms':
        return this.synonyms(usage, left);
      case 'leads':
        return this.leadDraft(usage);
      case 'specs':
        return this.specs(usage);
      case 'duplicates':
        return this.duplicates(usage, left);
      case 'landings':
        return this.landings(usage, left);
      case 'variants':
        return this.variants(usage);
    }
  }

  /* ---- 1. Autopilot ---------------------------------------------------------- */

  /**
   * Starts an ordinary AI task for published products no AI task has written
   * yet — best cards (photo, text) and the newest first. One autopilot task
   * at a time: the next one starts once the last has finished.
   */
  private async autopilot(
    settings: AssistJobSettings,
    left: number,
  ): Promise<StepResult> {
    const busy = await this.prisma.aiTask.count({
      where: {
        createdBy: ASSIST_ACTOR,
        status: {
          in: [AiTaskStatus.QUEUED, AiTaskStatus.RUNNING, AiTaskStatus.PAUSED],
        },
      },
    });
    if (busy)
      return {
        result: 'idle',
        items: 0,
        note: 'ждёт окончания прошлой задачи',
      };

    const rows = await this.prisma.product.findMany({
      // «No AI text yet» — not «no AI lock at all»: the categorize job locks
      // `categoryId`, and such a product still needs its texts.
      where: {
        status: 'PUBLISHED',
        NOT: { aiLockedFields: { hasSome: AUTOPILOT_TEXT_FIELDS } },
      },
      orderBy: [{ listingRank: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true },
      take: Math.min(left, 1000),
    });
    if (!rows.length)
      return { result: 'idle', items: 0, note: 'все товары уже обработаны' };

    const instruction = await this.autopilotInstruction(
      settings.template ?? '',
    );
    const fields = (settings.fields ?? []).length
      ? settings.fields!
      : ASSIST_JOB_INFO.autopilot.defaults.fields!;
    const task = await this.ai.createTask(
      {
        name: `Автопилот · ${new Date().toISOString().slice(0, 10)}`,
        entity: AiEntity.PRODUCT,
        fields,
        prompt: instruction.general,
        fieldPrompts: instruction.fields,
        promptId: instruction.promptId,
        templates: true,
        ids: rows.map((row) => row.id),
      },
      ASSIST_ACTOR,
    );
    return {
      result: 'done',
      items: rows.length,
      note: `задач: ${task.tasks?.length ?? 1}`,
    };
  }

  private async autopilotInstruction(template: string) {
    if (template.startsWith('preset:')) {
      const preset = AI_PRESETS.find(
        (item) => `preset:${item.id}` === template,
      );
      if (preset) return { general: preset.general, fields: preset.fieldTexts };
    }
    if (template.startsWith('prompt:')) {
      const prompt = await this.prisma.aiPrompt.findUnique({
        where: { id: template.slice('prompt:'.length) },
      });
      if (prompt) {
        return {
          general: prompt.text,
          fields: (prompt.fieldTexts ?? {}) as Record<string, string>,
          promptId: prompt.id,
        };
      }
    }
    return { general: '', fields: {} as Record<string, string> };
  }

  /* ---- 2. The fallback category -------------------------------------------- */

  private async fallbackCategoryId() {
    const row = await this.prisma.category.findUnique({
      where: { slug: FALLBACK_CATEGORY_SLUG },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Products in «Неразобранные товары поставщиков» get a real category: the
   * model picks one of the candidates — categories of products the search
   * finds for the item's kind, and categories named like it. Confident picks
   * are applied (and locked against the re-parse), the rest wait for an admin.
   */
  private async categorize(usage: Usage, left: number): Promise<StepResult> {
    const fallbackId = await this.fallbackCategoryId();
    if (!fallbackId)
      return { result: 'idle', items: 0, note: 'нет резервной категории' };
    const rows = await this.prisma.product.findMany({
      where: {
        categoryId: fallbackId,
        NOT: [
          { aiLockedFields: { has: 'categoryId' } },
          { lockedFields: { has: 'categoryId' } },
        ],
      },
      orderBy: { id: 'asc' },
      take: 60,
      select: {
        id: true,
        name: true,
        brand: { select: { name: true } },
        productSpecs: {
          take: 6,
          select: { value: true, specification: { select: { name: true } } },
        },
      },
    });
    const seen = new Set(
      (
        await this.prisma.aiSuggestion.findMany({
          where: {
            kind: AiSuggestionKind.CATEGORY,
            key: { in: rows.map((r) => r.id) },
          },
          select: { key: true },
        })
      ).map((row) => row.key),
    );
    const todo = rows
      .filter((row) => !seen.has(row.id))
      .slice(0, Math.min(CATEGORIZE_BATCH, left));
    if (!todo.length)
      return {
        result: 'idle',
        items: 0,
        note: 'резервная категория разобрана',
      };

    const items: CategorizeItem[] = [];
    for (const product of todo) {
      items.push({
        id: product.id,
        name: product.name,
        brand: product.brand?.name ?? null,
        specs: product.productSpecs.map(
          (spec) => `${spec.specification.name}: ${spec.value}`,
        ),
        candidates: await this.categoryCandidates(product.name, fallbackId),
      });
    }

    const ask = items.filter((item) => item.candidates.length);
    const verdicts = ask.length
      ? parseCategorizeAnswer(
          (await this.ask('categorize', usage, buildCategorizeMessages(ask)))
            .content,
          ask,
        )
      : new Map();

    for (const item of items) {
      const verdict = verdicts.get(item.id);
      const to = verdict?.categoryId
        ? item.candidates.find(
            (candidate) => candidate.id === verdict.categoryId,
          )
        : null;
      const payload = {
        productId: item.id,
        from: fallbackId,
        to: to?.id ?? null,
        toPath: to?.path ?? null,
        reason:
          verdict?.reason ??
          (item.candidates.length ? '' : 'не нашлось похожих категорий'),
        candidates: item.candidates,
      };
      const title = item.name;
      if (verdict?.confident && to) {
        await this.applyCategory(item.id, fallbackId, to.id);
        await this.saveSuggestion(
          AiSuggestionKind.CATEGORY,
          item.id,
          title,
          payload,
          {
            status: AiSuggestionStatus.APPLIED,
            auto: true,
          },
        );
      } else {
        await this.saveSuggestion(
          AiSuggestionKind.CATEGORY,
          item.id,
          title,
          payload,
          {
            status: item.candidates.length
              ? AiSuggestionStatus.PENDING
              : AiSuggestionStatus.REJECTED,
          },
        );
      }
    }
    return { result: 'done', items: items.length };
  }

  /**
   * Up to ~12 categories: where the products the search finds for the item's
   * kind live, then categories whose name is like it. Visible ones only, and
   * never the fallback itself.
   */
  private async categoryCandidates(name: string, fallbackId: string) {
    const head = nameHead(name) || name.split(/\s+/).slice(0, 2).join(' ');
    const ids: string[] = [];
    const tsquery = buildFtsQuery(head);
    if (tsquery) {
      const rows = await this.prisma.$queryRaw<Array<{ categoryId: string }>>`
        SELECT "categoryId" FROM "Product"
        WHERE ${Prisma.raw(FTS_DOCUMENT_SQL)} @@ to_tsquery('russian', ${tsquery})
          AND "categoryId" <> ${fallbackId} AND "status" = 'PUBLISHED'
        GROUP BY "categoryId" ORDER BY count(*) DESC LIMIT 8`;
      ids.push(...rows.map((row) => row.categoryId));
    }
    const named = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Category"
      WHERE "isVisible" AND "id" <> ${fallbackId} AND similarity("name", ${head}) > 0.25
      ORDER BY similarity("name", ${head}) DESC LIMIT 5`;
    ids.push(...named.map((row) => row.id));
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const categories = await this.prisma.category.findMany({
      where: { id: { in: unique }, isVisible: true },
      select: {
        id: true,
        name: true,
        parent: {
          select: {
            name: true,
            isVisible: true,
            parent: { select: { name: true, isVisible: true } },
          },
        },
      },
    });
    const byId = new Map(categories.map((category) => [category.id, category]));
    return unique
      .map((id) => byId.get(id))
      .filter(
        (category): category is NonNullable<typeof category> =>
          Boolean(category) &&
          category!.parent?.isVisible !== false &&
          category!.parent?.parent?.isVisible !== false,
      )
      .map((category) => ({
        id: category.id,
        path: [
          category.parent?.parent?.name,
          category.parent?.name,
          category.name,
        ]
          .filter(Boolean)
          .join(' / '),
      }));
  }

  /** Moves the product and locks the category: the next parse must not put it back. */
  private async applyCategory(productId: string, from: string, to: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { categoryId: true, aiLockedFields: true },
    });
    if (!product) throw new NotFoundException('Товар удалён');
    if (product.categoryId !== from) {
      throw new ConflictException('Категорию товара уже поменяли');
    }
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        categoryId: to,
        aiLockedFields: [...new Set([...product.aiLockedFields, 'categoryId'])],
      },
    });
  }

  /* ---- 3. Search synonyms --------------------------------------------------- */

  private async acceptedSynonyms(): Promise<string[][]> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: SEARCH_SYNONYMS_SETTING },
    });
    return cleanSynonymGroups(row ? safeJson(row.value) : []);
  }

  private async countMatches(term: string, groups: string[][]) {
    const tsquery = buildFtsQuery(term, groups);
    if (!tsquery) return { count: 0, examples: [] as string[] };
    const [count, examples] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM "Product"
        WHERE ${Prisma.raw(FTS_DOCUMENT_SQL)} @@ to_tsquery('russian', ${tsquery})
          AND "status" = 'PUBLISHED'`,
      this.prisma.$queryRaw<Array<{ name: string }>>`
        SELECT "name" FROM "Product"
        WHERE ${Prisma.raw(FTS_DOCUMENT_SQL)} @@ to_tsquery('russian', ${tsquery})
          AND "status" = 'PUBLISHED'
        ORDER BY "listingRank" DESC LIMIT 3`,
    ]);
    return {
      count: Number(count[0]?.n ?? 0),
      examples: examples.map((row) => row.name),
    };
  }

  /**
   * Searches that found nothing (twice or more in 30 days) → a synonym
   * group, kept only if the term then finds products. The admin accepts it.
   */
  private async synonyms(usage: Usage, left: number): Promise<StepResult> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.$queryRaw<
      Array<{ term: string; n: bigint }>
    >`
      SELECT "term", count(*) AS n FROM "SearchEvent"
      WHERE "kind" = 'SEARCH' AND "results" = 0 AND "createdAt" >= ${since}
        AND length("term") BETWEEN 3 AND 60
      GROUP BY "term" HAVING count(*) >= 2
      ORDER BY n DESC LIMIT 200`;
    const seen = new Set(
      (
        await this.prisma.aiSuggestion.findMany({
          where: {
            kind: AiSuggestionKind.SYNONYM,
            key: { in: rows.map((r) => r.term) },
          },
          select: { key: true },
        })
      ).map((row) => row.key),
    );
    const terms = rows
      .filter((row) => !seen.has(row.term) && !/^\d+$/.test(row.term))
      .slice(0, Math.min(SYNONYM_BATCH, left))
      .map((row, index) => ({
        id: `t${index + 1}`,
        term: row.term,
        searches: Number(row.n),
      }));
    if (!terms.length)
      return {
        result: 'idle',
        items: 0,
        note: 'новых запросов без результата нет',
      };

    const answer = await this.ask(
      'synonyms',
      usage,
      buildSynonymMessages(terms),
    );
    const proposals = new Map(
      parseSynonymAnswer(answer.content, terms).map((p) => [p.term, p.group]),
    );
    const accepted = await this.acceptedSynonyms();
    for (const term of terms) {
      const group = proposals.get(term.term);
      if (!group) {
        await this.saveSuggestion(
          AiSuggestionKind.SYNONYM,
          term.term,
          term.term,
          {
            term: term.term,
            searches: term.searches,
            group: null,
            reason: 'не похоже на название товара',
          },
          { status: AiSuggestionStatus.REJECTED, auto: true },
        );
        continue;
      }
      const now = await this.countMatches(term.term, accepted);
      const withGroup = await this.countMatches(term.term, [
        ...accepted,
        group,
      ]);
      const useful = now.count === 0 && withGroup.count > 0;
      await this.saveSuggestion(
        AiSuggestionKind.SYNONYM,
        term.term,
        `«${term.term}» → ${group.join(', ')}`,
        {
          term: term.term,
          searches: term.searches,
          group,
          wouldFind: withGroup.count,
          examples: withGroup.examples,
          reason: useful
            ? ''
            : now.count
              ? 'поиск уже находит товары по этому запросу'
              : 'и с синонимом ничего не находит',
        },
        useful
          ? { status: AiSuggestionStatus.PENDING }
          : { status: AiSuggestionStatus.REJECTED, auto: true },
      );
    }
    return { result: 'done', items: terms.length };
  }

  /* ---- 4. Lead drafts ------------------------------------------------------- */

  private async leadDraft(usage: Usage): Promise<StepResult> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        kind: 'QUESTION',
        status: 'NEW',
        aiDraftAt: null,
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!lead) return { result: 'idle', items: 0, note: 'новых заявок нет' };

    const candidates = await this.leadCandidates(lead.productId, lead.message);
    if (!lead.message?.trim() && !lead.productId) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { aiDraftAt: new Date() },
      });
      return { result: 'done', items: 1, note: 'в заявке нет вопроса' };
    }
    const answer = await this.ask(
      'leads',
      usage,
      buildLeadMessages(
        {
          message: lead.message,
          productName: lead.productName,
          companyName: lead.companyName,
        },
        candidates,
      ),
    );
    const draft = parseLeadAnswer(answer.content, candidates);
    const products = draft?.productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: draft.productIds } },
          select: {
            id: true,
            name: true,
            slug: true,
            priceValue: true,
            stockStatus: true,
          },
        })
      : [];
    const order = new Map(
      draft?.productIds.map((id, index) => [id, index]) ?? [],
    );
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        aiDraftAt: new Date(),
        aiDraft: draft
          ? ({
              text: draft.text,
              products: products.sort(
                (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
              ),
              model: answer.model,
            } as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
    return { result: 'done', items: 1, note: `заявка №${lead.number}` };
  }

  /**
   * What a draft may offer: the asked product's neighbours in its category
   * (in stock and complete cards first) and what the search finds for the
   * words of the message — the model picks among these only.
   */
  private async leadCandidates(
    productId: string | null,
    message: string | null,
  ): Promise<LeadCandidate[]> {
    const ids: string[] = [];
    if (productId) {
      const asked = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { categoryId: true, name: true },
      });
      if (asked) {
        const neighbours = await this.prisma.product.findMany({
          where: {
            categoryId: asked.categoryId,
            status: 'PUBLISHED',
            id: { not: productId },
          },
          orderBy: [{ stockStatus: 'asc' }, { listingRank: 'desc' }],
          take: 12,
          select: { id: true },
        });
        ids.push(...neighbours.map((row) => row.id));
      }
    }
    const words = (message ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4)
      .slice(0, 8);
    const parts = words
      .map((word) => buildFtsQuery(word))
      .filter((part): part is string => Boolean(part));
    if (parts.length) {
      const tsquery = parts.map((part) => `(${part})`).join(' | ');
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Product"
        WHERE ${Prisma.raw(FTS_DOCUMENT_SQL)} @@ to_tsquery('russian', ${tsquery})
          AND "status" = 'PUBLISHED'
        ORDER BY ts_rank(${Prisma.raw(FTS_DOCUMENT_SQL)}, to_tsquery('russian', ${tsquery})) DESC,
          "listingRank" DESC
        LIMIT 10`;
      ids.push(...rows.map((row) => row.id));
    }
    const unique = [...new Set(ids)].slice(0, 20);
    if (!unique.length) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        name: true,
        stockStatus: true,
        brand: { select: { name: true } },
      },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand?.name ?? null,
      inStock: product.stockStatus === 'in_stock',
    }));
  }

  /* ---- 5. Same characteristic, different names ----------------------------- */

  private async specs(usage: Usage): Promise<StepResult> {
    const roots = await this.prisma.category.findMany({
      where: {
        parentId: null,
        isVisible: true,
        slug: { not: FALLBACK_CATEGORY_SLUG },
      },
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    if (!roots.length) return { result: 'idle', items: 0 };
    const index = roots.findIndex((root) => root.id > (usage.cursor ?? ''));
    const root = roots[index < 0 ? 0 : index];
    usage.cursor = root.id;

    const aliases = parseSpecAliases(
      (
        await this.prisma.siteSetting.findUnique({
          where: { key: SPEC_ALIASES_SETTING },
        })
      )?.value,
    );
    const rows = await this.prisma.$queryRaw<
      Array<{
        key: string;
        name: string;
        unit: string | null;
        products: bigint;
        samples: string[];
      }>
    >`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Category" WHERE id = ${root.id}
        UNION ALL
        SELECT c.id FROM "Category" c JOIN sub ON c."parentId" = sub.id
      )
      SELECT s."canonicalKey" AS key,
             max(COALESCE(s."canonicalName", s."name")) AS name,
             max(s."canonicalUnit") AS unit,
             count(DISTINCT ps."productId") AS products,
             (array_agg(DISTINCT ps."value"))[1:5] AS samples
      FROM "Specification" s
      JOIN "ProductSpecification" ps ON ps."specificationId" = s.id
      WHERE s."categoryId" IN (SELECT id FROM sub) AND s."canonicalKey" IS NOT NULL
      GROUP BY s."canonicalKey"
      HAVING count(DISTINCT ps."productId") >= 3
      ORDER BY products DESC
      LIMIT 120`;
    const specs: SpecGroupInput[] = rows
      .filter((row) => !aliases[row.key])
      .map((row) => ({
        key: row.key,
        name: row.name,
        unit: row.unit,
        products: Number(row.products),
        samples: (row.samples ?? []).map((value) => value.slice(0, 40)),
      }));
    if (specs.length < 2) return { result: 'done', items: 1, note: root.name };

    const answer = await this.ask(
      'specs',
      usage,
      buildSpecMessages(root.name, specs),
    );
    const proposals = parseSpecAnswer(answer.content, specs);
    const byKey = new Map(specs.map((spec) => [spec.key, spec]));
    for (const proposal of proposals) {
      await this.saveSuggestion(
        AiSuggestionKind.SPEC_MERGE,
        proposal.keys.join('|'),
        `${proposal.name}: ${proposal.keys.map((key) => byKey.get(key)?.name ?? key).join(' + ')}`,
        {
          ...proposal,
          category: root.name,
          members: proposal.keys.map((key) => byKey.get(key)),
        },
        { status: AiSuggestionStatus.PENDING },
      );
    }
    return {
      result: 'done',
      items: 1,
      note: `${root.name}: предложений ${proposals.length}`,
    };
  }

  /* ---- 6. Duplicates ---------------------------------------------------------- */

  private async duplicates(usage: Usage, left: number): Promise<StepResult> {
    const groups = await this.offers.findDuplicates(200);
    const keyed = groups.map((group) => ({
      group,
      key: `${group.signal}:${group.key}`,
      ids: group.products.map((product) => product.id).sort(),
    }));
    const known = new Map(
      (
        await this.prisma.aiSuggestion.findMany({
          where: {
            kind: AiSuggestionKind.DUPLICATE,
            key: { in: keyed.map((k) => k.key) },
          },
          select: { key: true, payload: true },
        })
      ).map((row) => [
        row.key,
        (row.payload as { productIds?: string[] }).productIds?.join(','),
      ]),
    );
    const todo = keyed
      .filter((item) => known.get(item.key) !== item.ids.join(','))
      .slice(0, Math.min(DUPLICATE_BATCH, left));
    if (!todo.length)
      return { result: 'idle', items: 0, note: 'все группы с мнением' };

    const specs = await this.prisma.productSpecification.findMany({
      where: { productId: { in: todo.flatMap((item) => item.ids) } },
      select: {
        productId: true,
        value: true,
        specification: { select: { name: true } },
      },
      take: 400,
    });
    const specsOf = (id: string) =>
      specs
        .filter((spec) => spec.productId === id)
        .slice(0, 8)
        .map((spec) => `${spec.specification.name}: ${spec.value}`);
    const inputs: DuplicateGroupInput[] = todo.map((item, index) => ({
      id: `g${index + 1}`,
      products: item.group.products.map((product) => ({
        id: product.id,
        name: product.name,
        brand: product.brandName,
        sku: product.sku,
        model: product.model,
        barcode: product.barcode,
        specs: specsOf(product.id),
      })),
    }));
    const answer = await this.ask(
      'duplicates',
      usage,
      buildDuplicateMessages(inputs),
    );
    const verdicts = parseDuplicateAnswer(answer.content, inputs);
    for (const [index, item] of todo.entries()) {
      const verdict = verdicts.get(`g${index + 1}`);
      if (!verdict) continue;
      await this.saveSuggestion(
        AiSuggestionKind.DUPLICATE,
        item.key,
        item.group.products
          .map((product) => product.name)
          .join(' / ')
          .slice(0, 300),
        { productIds: item.ids, ...verdict, model: answer.model },
        { status: AiSuggestionStatus.INFO },
      );
    }
    return { result: 'done', items: todo.length };
  }

  /** The verdicts for /admin/duplicates, keyed like its groups (`signal:key`). */
  async duplicateVerdicts() {
    const rows = await this.prisma.aiSuggestion.findMany({
      where: { kind: AiSuggestionKind.DUPLICATE },
      select: { key: true, payload: true, createdAt: true },
    });
    return Object.fromEntries(
      rows.map((row) => [
        row.key,
        { ...(row.payload as object), at: row.createdAt },
      ]),
    );
  }

  /* ---- 7. Category + brand landings ------------------------------------------ */

  private async landings(usage: Usage, left: number): Promise<StepResult> {
    const fallbackId = await this.fallbackCategoryId();
    const rows = await this.prisma.$queryRaw<
      Array<{ brandId: string; categoryId: string; n: bigint }>
    >`
      SELECT p."brandId", p."categoryId", count(*) AS n
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE p."status" = 'PUBLISHED' AND p."brandId" IS NOT NULL AND c."isVisible"
        AND c.id <> ${fallbackId ?? ''}
        AND NOT EXISTS (
          SELECT 1 FROM "BrandCategoryLanding" l
          WHERE l."brandId" = p."brandId" AND l."categoryId" = p."categoryId")
      GROUP BY p."brandId", p."categoryId"
      HAVING count(*) >= ${LANDING_MIN_PRODUCTS}
      ORDER BY n DESC
      LIMIT ${Math.min(LANDING_BATCH, left)}`;
    if (!rows.length)
      return { result: 'idle', items: 0, note: 'все сочетания с текстом' };

    const inputs: LandingInput[] = [];
    const meta = new Map<
      string,
      { brandId: string; categoryId: string; slug: string; count: number }
    >();
    for (const row of rows) {
      const [brand, category, examples] = await Promise.all([
        this.prisma.brand.findUnique({
          where: { id: row.brandId },
          select: { name: true },
        }),
        this.prisma.category.findUnique({
          where: { id: row.categoryId },
          select: {
            name: true,
            slug: true,
            parent: {
              select: { name: true, parent: { select: { name: true } } },
            },
          },
        }),
        this.prisma.product.findMany({
          where: {
            brandId: row.brandId,
            categoryId: row.categoryId,
            status: 'PUBLISHED',
          },
          orderBy: { listingRank: 'desc' },
          take: 8,
          select: { name: true },
        }),
      ]);
      if (!brand || !category) continue;
      const id = `${row.brandId}:${row.categoryId}`;
      meta.set(id, {
        brandId: row.brandId,
        categoryId: row.categoryId,
        slug: category.slug,
        count: Number(row.n),
      });
      inputs.push({
        id,
        brand: brand.name,
        category: category.name,
        path: [
          category.parent?.parent?.name,
          category.parent?.name,
          category.name,
        ]
          .filter(Boolean)
          .join(' / '),
        productCount: Number(row.n),
        examples: examples.map((product) => product.name),
      });
    }
    if (!inputs.length) return { result: 'idle', items: 0 };

    const answer = await this.ask(
      'landings',
      usage,
      buildLandingMessages(inputs),
    );
    const results = parseLandingAnswer(answer.content, inputs);
    const announce: string[] = [];
    for (const [id, result] of results) {
      const info = meta.get(id)!;
      if (!result.texts) continue;
      const isPublished = !Object.keys(result.rejected).length;
      await this.prisma.brandCategoryLanding.upsert({
        where: {
          brandId_categoryId: {
            brandId: info.brandId,
            categoryId: info.categoryId,
          },
        },
        create: {
          brandId: info.brandId,
          categoryId: info.categoryId,
          ...result.texts,
          isPublished,
          rejected: isPublished
            ? Prisma.DbNull
            : (result.rejected as Prisma.InputJsonValue),
          productCount: info.count,
          model: answer.model,
        },
        update: {
          ...result.texts,
          isPublished,
          rejected: isPublished
            ? Prisma.DbNull
            : (result.rejected as Prisma.InputJsonValue),
          productCount: info.count,
          model: answer.model,
        },
      });
      if (isPublished) announce.push(landingPath(info.slug, info.brandId));
    }
    await this.indexNow.enqueue(announce);
    return { result: 'done', items: inputs.length };
  }

  /** Public: the published landing for a category slug + brand id, or null. */
  async publicLanding(categorySlug: string, brandId: string) {
    const landing = await this.prisma.brandCategoryLanding.findFirst({
      where: { isPublished: true, brandId, category: { slug: categorySlug } },
      select: {
        h1: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
      },
    });
    return landing;
  }

  /** Public: every published landing — the sitemap lists them. */
  publicLandings() {
    return this.prisma.brandCategoryLanding
      .findMany({
        where: { isPublished: true, category: { isVisible: true } },
        select: {
          brandId: true,
          updatedAt: true,
          category: { select: { slug: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      .then((rows) =>
        rows.map((row) => ({
          categorySlug: row.category.slug,
          brandId: row.brandId,
          updatedAt: row.updatedAt,
        })),
      );
  }

  async listLandings(page = 1, published?: boolean) {
    const where: Prisma.BrandCategoryLandingWhereInput =
      published === undefined ? {} : { isPublished: published };
    const limit = 30;
    const [data, total] = await Promise.all([
      this.prisma.brandCategoryLanding.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.brandCategoryLanding.count({ where }),
    ]);
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async setLandingPublished(id: string, isPublished: boolean) {
    const landing = await this.prisma.brandCategoryLanding.findUnique({
      where: { id },
      include: { category: { select: { slug: true } } },
    });
    if (!landing) throw new NotFoundException('Страница не найдена');
    await this.prisma.brandCategoryLanding.update({
      where: { id },
      data: { isPublished },
    });
    await this.indexNow.enqueue([
      landingPath(landing.category.slug, landing.brandId),
    ]);
    return { ok: true };
  }

  /** Deleted — the job writes it again (a fresh text) on one of its next runs. */
  async deleteLanding(id: string) {
    await this.prisma.brandCategoryLanding.deleteMany({ where: { id } });
    return { ok: true };
  }

  /* ---- 8. Sizes of one line --------------------------------------------------- */

  private async variants(usage: Usage): Promise<StepResult> {
    const groups = await this.prisma.$queryRaw<
      Array<{ brandId: string; categoryId: string; ids: string[]; n: bigint }>
    >`
      SELECT p."brandId", p."categoryId", array_agg(p.id ORDER BY p.name) AS ids, count(*) AS n
      FROM "Product" p
      LEFT JOIN "ProductFamily" f ON f."productId" = p.id
      WHERE p."status" = 'PUBLISHED' AND p."brandId" IS NOT NULL
        AND (p."variantLine" IS NULL OR p."variantLine" = '')
        AND (f."familyKey" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "ProductFamily" g
          WHERE g."familyKey" = f."familyKey" AND g."productId" <> p.id))
      GROUP BY p."brandId", p."categoryId"
      HAVING count(*) BETWEEN 2 AND ${VARIANT_GROUP_MAX}
      ORDER BY n DESC
      LIMIT 300`;
    // A group is asked about again only when its products changed.
    const scans = new Map(
      (
        await this.prisma.aiSuggestion.findMany({
          where: {
            kind: AiSuggestionKind.VARIANT,
            key: { in: groups.map((g) => `scan:${g.brandId}:${g.categoryId}`) },
          },
          select: { key: true, payload: true },
        })
      ).map((row) => [row.key, (row.payload as { hash?: string }).hash]),
    );
    const group = groups.find(
      (g) =>
        scans.get(`scan:${g.brandId}:${g.categoryId}`) !== md5(g.ids.join(',')),
    );
    if (!group)
      return { result: 'idle', items: 0, note: 'все группы просмотрены' };

    const [brand, category, products] = await Promise.all([
      this.prisma.brand.findUnique({
        where: { id: group.brandId },
        select: { name: true },
      }),
      this.prisma.category.findUnique({
        where: { id: group.categoryId },
        select: { name: true },
      }),
      this.prisma.product.findMany({
        where: { id: { in: group.ids } },
        select: { id: true, name: true },
      }),
    ]);
    const answer = await this.ask(
      'variants',
      usage,
      buildVariantMessages(brand?.name ?? '', category?.name ?? '', products),
    );
    const proposals = parseVariantAnswer(answer.content, products);
    const names = new Map(
      products.map((product) => [product.id, product.name]),
    );
    for (const proposal of proposals) {
      const ids = proposal.members.map((member) => member.id).sort();
      await this.saveSuggestion(
        AiSuggestionKind.VARIANT,
        md5(ids.join(',')),
        `${proposal.line} (${proposal.members.length} размеров)`,
        {
          ...proposal,
          brandId: group.brandId,
          categoryId: group.categoryId,
          names: Object.fromEntries(ids.map((id) => [id, names.get(id)])),
        },
        { status: AiSuggestionStatus.PENDING },
      );
    }
    await this.saveSuggestion(
      AiSuggestionKind.VARIANT,
      `scan:${group.brandId}:${group.categoryId}`,
      `${brand?.name ?? ''} / ${category?.name ?? ''}`,
      { hash: md5(group.ids.join(',')), proposals: proposals.length },
      { status: AiSuggestionStatus.INFO },
    );
    return {
      result: 'done',
      items: 1,
      note: `${brand?.name} / ${category?.name}: ${proposals.length}`,
    };
  }

  /* ---- Suggestions ------------------------------------------------------------- */

  private async saveSuggestion(
    kind: AiSuggestionKind,
    key: string,
    title: string,
    payload: Record<string, unknown>,
    options: { status: AiSuggestionStatus; auto?: boolean },
  ) {
    const auto = options.auto ?? false;
    const decided =
      options.status === AiSuggestionStatus.PENDING ||
      options.status === AiSuggestionStatus.INFO
        ? {}
        : { decidedAt: new Date(), decidedBy: ASSIST_ACTOR };
    await this.prisma.aiSuggestion.upsert({
      where: { kind_key: { kind, key } },
      create: {
        kind,
        key,
        title: title.slice(0, 500),
        payload: payload as Prisma.InputJsonValue,
        status: options.status,
        auto,
        model: this.client.defaultModel,
        ...decided,
      },
      update: {
        title: title.slice(0, 500),
        payload: payload as Prisma.InputJsonValue,
        status: options.status,
        auto,
        ...decided,
      },
    });
  }

  async listSuggestions(query: {
    kind?: AiSuggestionKind;
    status?: AiSuggestionStatus;
    auto?: boolean;
    page?: number;
  }) {
    const page = query.page ?? 1;
    const limit = 30;
    const where: Prisma.AiSuggestionWhereInput = {
      kind: query.kind,
      status: query.status ?? { not: AiSuggestionStatus.INFO },
      ...(query.auto !== undefined ? { auto: query.auto } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.aiSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.aiSuggestion.count({ where }),
    ]);
    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  private async requireSuggestion(id: string) {
    const row = await this.prisma.aiSuggestion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Предложение не найдено');
    return row;
  }

  /**
   * Applies a proposal. A category proposal may come with the admin's own
   * pick among its candidates (`categoryId`).
   */
  async apply(
    id: string,
    by: string | null,
    options: { categoryId?: string } = {},
  ) {
    const row = await this.requireSuggestion(id);
    if (row.status !== AiSuggestionStatus.PENDING) {
      throw new ConflictException('Предложение уже рассмотрено');
    }
    const payload = row.payload as Record<string, unknown>;
    switch (row.kind) {
      case AiSuggestionKind.CATEGORY: {
        const candidates =
          (payload.candidates as Array<{ id: string; path: string }>) ?? [];
        const to = options.categoryId ?? (payload.to as string | null);
        const chosen = candidates.find((candidate) => candidate.id === to);
        if (!to) throw new BadRequestException('Выберите категорию');
        const exists = chosen
          ? true
          : Boolean(
              await this.prisma.category.findUnique({
                where: { id: to },
                select: { id: true },
              }),
            );
        if (!exists) throw new BadRequestException('Категория не найдена');
        await this.applyCategory(
          String(payload.productId),
          String(payload.from),
          to,
        );
        payload.to = to;
        payload.toPath = chosen?.path ?? payload.toPath;
        break;
      }
      case AiSuggestionKind.SYNONYM: {
        const groups = await this.acceptedSynonyms();
        const group = cleanSynonymGroups([payload.group])[0];
        if (!group) throw new BadRequestException('Пустая группа');
        await this.saveSetting(
          SEARCH_SYNONYMS_SETTING,
          JSON.stringify([...groups, group]),
        );
        break;
      }
      case AiSuggestionKind.SPEC_MERGE: {
        const keys = payload.keys as string[];
        const into = String(payload.into);
        const name = String(payload.name);
        const current = parseSpecAliases(
          (
            await this.prisma.siteSetting.findUnique({
              where: { key: SPEC_ALIASES_SETTING },
            })
          )?.value,
        );
        let next;
        try {
          next = addSpecAliases(current, keys, { key: into, name });
        } catch (error) {
          throw new BadRequestException((error as Error).message);
        }
        await this.saveSetting(SPEC_ALIASES_SETTING, JSON.stringify(next));
        // At once, not only at night: the facets group by canonicalKey.
        await this.prisma.specification.updateMany({
          where: { canonicalKey: { in: keys } },
          data: { canonicalKey: into, canonicalName: name },
        });
        break;
      }
      case AiSuggestionKind.VARIANT: {
        const line = String(payload.line);
        const members = payload.members as Array<{ id: string; label: string }>;
        await this.prisma.$transaction(
          members.map((member) =>
            this.prisma.product.updateMany({
              where: {
                id: member.id,
                OR: [{ variantLine: null }, { variantLine: '' }],
              },
              // contentUpdatedAt: the relations worker re-reads the family within a tick.
              data: {
                variantLine: line,
                variantLabel: member.label,
                contentUpdatedAt: new Date(),
              },
            }),
          ),
        );
        break;
      }
      default:
        throw new BadRequestException('Это мнение, применять нечего');
    }
    return this.decide(row, AiSuggestionStatus.APPLIED, by, payload);
  }

  async reject(id: string, by: string | null) {
    const row = await this.requireSuggestion(id);
    if (row.status !== AiSuggestionStatus.PENDING) {
      throw new ConflictException('Предложение уже рассмотрено');
    }
    return this.decide(row, AiSuggestionStatus.REJECTED, by);
  }

  /** Undoes an applied proposal where what it wrote is still there. */
  async revert(id: string, by: string | null) {
    const row = await this.requireSuggestion(id);
    if (row.status !== AiSuggestionStatus.APPLIED) {
      throw new ConflictException('Откатывать нечего');
    }
    const payload = row.payload as Record<string, unknown>;
    switch (row.kind) {
      case AiSuggestionKind.CATEGORY: {
        const product = await this.prisma.product.findUnique({
          where: { id: String(payload.productId) },
          select: { categoryId: true, aiLockedFields: true },
        });
        if (product && product.categoryId === payload.to) {
          await this.prisma.product.update({
            where: { id: String(payload.productId) },
            data: {
              categoryId: String(payload.from),
              aiLockedFields: product.aiLockedFields.filter(
                (key) => key !== 'categoryId',
              ),
            },
          });
        }
        break;
      }
      case AiSuggestionKind.SYNONYM: {
        const group = JSON.stringify(
          cleanSynonymGroups([payload.group])[0] ?? [],
        );
        const groups = (await this.acceptedSynonyms()).filter(
          (item) => JSON.stringify(item) !== group,
        );
        await this.saveSetting(SEARCH_SYNONYMS_SETTING, JSON.stringify(groups));
        break;
      }
      case AiSuggestionKind.VARIANT: {
        const line = String(payload.line);
        const members = payload.members as Array<{ id: string; label: string }>;
        await this.prisma.product.updateMany({
          where: {
            id: { in: members.map((member) => member.id) },
            variantLine: line,
          },
          data: {
            variantLine: null,
            variantLabel: null,
            contentUpdatedAt: new Date(),
          },
        });
        break;
      }
      default:
        // A spec fold is not undone: the nightly normalizer may already have
        // merged the rows of one category, which cannot be split back.
        throw new BadRequestException('Это предложение не откатывается');
    }
    return this.decide(row, AiSuggestionStatus.REVERTED, by);
  }

  private async decide(
    row: AiSuggestion,
    status: AiSuggestionStatus,
    by: string | null,
    payload?: Record<string, unknown>,
  ) {
    return this.prisma.aiSuggestion.update({
      where: { id: row.id },
      data: {
        status,
        decidedAt: new Date(),
        decidedBy: by,
        ...(payload ? { payload: payload as Prisma.InputJsonValue } : {}),
      },
    });
  }

  private saveSetting(key: string, value: string) {
    return this.prisma.siteSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

/** The storefront path of a landing — the brand page's own link. */
export function landingPath(categorySlug: string, brandId: string) {
  return `/catalog/${categorySlug}?brands=${brandId}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
