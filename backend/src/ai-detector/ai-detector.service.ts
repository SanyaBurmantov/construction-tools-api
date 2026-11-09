import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DetectorClient, type DetectorReport } from './detector.client';
import { MAX_TEXT_CHARS } from './limits';
import { fetchReadablePage } from './page-fetch';
import {
  UniquenessService,
  uniquenessForSeo,
  type UniquenessReport,
} from './uniqueness.service';

const MIN_TEXT_CHARS = 20;
const DEFAULT_TTL_DAYS = 365;

const LIST_SELECT = {
  id: true,
  createdAt: true,
  createdBy: true,
  source: true,
  url: true,
  title: true,
  probability: true,
  verdict: true,
  words: true,
  model: true,
} satisfies Prisma.AiDetectorCheckSelect;

@Injectable()
export class AiDetectorService {
  private readonly logger = new Logger(AiDetectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly detector: DetectorClient,
    private readonly uniqueness: UniquenessService,
  ) {}

  async status() {
    return {
      configured: this.detector.configured,
      ...(await this.detector.health()),
    };
  }

  /**
   * Checks pasted text, or the readable text of a page, and keeps the result:
   * the detector's opinion and, beside it, how unique the text is against
   * our catalogue, the product's supplier text and any pages named.
   */
  async check(
    input: {
      text?: string;
      url?: string;
      compareUrls?: string[];
      productName?: string;
    },
    createdBy: string | null,
    seo = false,
  ) {
    const url = input.url?.trim();
    let text = input.text?.trim() ?? '';
    let title: string | null = null;
    let picked: string | null = null;
    if (url) {
      const page = await fetchReadablePage(url);
      text = page.text;
      title = page.title;
      picked = page.picked;
    }
    if (text.length < MIN_TEXT_CHARS) {
      throw new BadRequestException(
        url
          ? 'На странице не нашлось текста для проверки'
          : `Текст короче ${MIN_TEXT_CHARS} символов`,
      );
    }
    let truncated = false;
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      truncated = true;
    }

    const compareUrls = (input.compareUrls ?? [])
      .map((u) => u.trim())
      .filter(Boolean);
    const [report, uniqueness] = await Promise.all([
      this.detector.analyze(text),
      // Uniqueness is a second opinion; its failure must not lose the first.
      this.uniqueness
        .check(text, {
          url,
          compareUrls,
          productName: input.productName,
          pageTitle: title,
        })
        .catch((error: Error): UniquenessReport | null => {
          this.logger.warn(`uniqueness failed: ${error.message}`);
          return null;
        }),
    ]);
    if (truncated) {
      report.warnings.push(
        `Проверены первые ${MAX_TEXT_CHARS.toLocaleString('ru-RU')} символов.`,
      );
    }
    const row = await this.prisma.aiDetectorCheck.create({
      data: {
        createdBy,
        source: url ? 'url' : 'text',
        url: url ?? null,
        title: title?.slice(0, 300) ?? null,
        text,
        textHash: createHash('sha256').update(text).digest('hex'),
        probability: report.probability,
        verdict: report.verdict.key,
        words: report.words,
        model: report.model,
        report: {
          ...report,
          picked,
          uniqueness,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return this.present(row, seo);
  }

  async list(page = 1, limit = 20, search?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const term = search?.trim();
    const where: Prisma.AiDetectorCheckWhereInput = term
      ? {
          OR: [
            { url: { contains: term, mode: 'insensitive' } },
            { title: { contains: term, mode: 'insensitive' } },
            { text: { contains: term, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.aiDetectorCheck.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.aiDetectorCheck.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), limit: take };
  }

  async get(id: string, seo = false) {
    const row = await this.prisma.aiDetectorCheck.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Проверка не найдена');
    return this.present(row, seo);
  }

  async remove(id: string) {
    await this.prisma.aiDetectorCheck.deleteMany({ where: { id } });
    return { ok: true };
  }

  async purgeOld() {
    const days = Number(process.env.AI_DETECTOR_TTL_DAYS) || DEFAULT_TTL_DAYS;
    const { count } = await this.prisma.aiDetectorCheck.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
    });
    if (count)
      this.logger.log(
        `purged ${count} detector checks older than ${days} days`,
      );
  }

  /**
   * The stored check as the screen gets it. An admin's check names the
   * supplier; the SEO role reads the same history, so that is stripped on
   * the way out, not on the way in.
   */
  private present(row: Prisma.AiDetectorCheckGetPayload<object>, seo: boolean) {
    const { textHash: _hash, report, ...rest } = row;
    const stored = report as unknown as DetectorReport & {
      picked?: string | null;
      uniqueness?: UniquenessReport | null;
    };
    return {
      ...rest,
      report: {
        ...stored,
        uniqueness:
          stored.uniqueness && seo
            ? uniquenessForSeo(stored.uniqueness)
            : (stored.uniqueness ?? null),
      },
    };
  }
}
