import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import { PrismaService } from '../prisma/prisma.service';
import { DetectorClient, type DetectorReport } from './detector.client';
import { MAX_TEXT_CHARS } from './limits';
import { extractPageText } from './page-text';
import { assertPublicUrl, UnsafeUrlError } from './safe-url';

const MIN_TEXT_CHARS = 20;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TTL_DAYS = 365;
const PAGE_USER_AGENT =
  'Mozilla/5.0 (compatible; GostByTextCheck/1.0; +https://gost.by)';

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
  ) {}

  async status() {
    return {
      configured: this.detector.configured,
      ...(await this.detector.health()),
    };
  }

  /** Checks pasted text, or the readable text of a page, and keeps the result. */
  async check(
    input: { text?: string; url?: string },
    createdBy: string | null,
  ) {
    const url = input.url?.trim();
    let text = input.text?.trim() ?? '';
    let title: string | null = null;
    let picked: string | null = null;
    if (url) {
      const page = await this.fetchPage(url);
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

    const report = await this.detector.analyze(text);
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
        report: { ...report, picked } as unknown as Prisma.InputJsonValue,
      },
    });
    return this.present(row);
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

  async get(id: string) {
    const row = await this.prisma.aiDetectorCheck.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Проверка не найдена');
    return this.present(row);
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

  private present(row: Prisma.AiDetectorCheckGetPayload<object>) {
    const { textHash: _hash, report, ...rest } = row;
    return {
      ...rest,
      report: report as unknown as DetectorReport & { picked?: string | null },
    };
  }

  /** Fetches a public page, following redirects by hand so each hop is vetted. */
  private async fetchPage(raw: string) {
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let url: URL;
      try {
        url = await assertPublicUrl(current);
      } catch (error) {
        if (error instanceof UnsafeUrlError)
          throw new BadRequestException(error.message);
        throw error;
      }
      let res: Response;
      try {
        res = await fetchWithTimeout(
          url.toString(),
          {
            redirect: 'manual',
            headers: {
              'User-Agent': PAGE_USER_AGENT,
              Accept: 'text/html,application/xhtml+xml',
              'Accept-Language': 'ru,en;q=0.5',
            },
          },
          { timeoutMs: 15_000, retries: 1, maxBytes: MAX_PAGE_BYTES },
        );
      } catch (error) {
        const message = (error as Error).message;
        throw new BadRequestException(
          /too large|maxBytes|exceeds/i.test(message)
            ? 'Страница больше 5 МБ'
            : 'Страница не открылась (нет ответа)',
        );
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) break;
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok) {
        throw new BadRequestException(`Страница ответила ${res.status}`);
      }
      const type = res.headers.get('content-type') ?? '';
      if (type && !/html|xml|text\/plain/i.test(type)) {
        throw new BadRequestException('По адресу не веб-страница');
      }
      const body = await res.text();
      return /text\/plain/i.test(type)
        ? { title: null, text: body.trim(), picked: 'текстовый файл' }
        : extractPageText(body);
    }
    throw new BadRequestException('Слишком много перенаправлений');
  }
}
