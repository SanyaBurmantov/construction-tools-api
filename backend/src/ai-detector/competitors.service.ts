import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CARDS_PER_COMPETITOR,
  DEFAULT_COMPETITORS,
  formatCompetitors,
  parseCompetitors,
  pickResultLinks,
  bareHost,
  type Competitor,
  type CompetitorQuery,
} from './competitors';
import { ourHosts } from './our-hosts';
import { fetchPublicPage, fetchReadablePage } from './page-fetch';

const SETTING_KEY = 'uniqueness.competitors';
/** One slow shop must not hold the whole check. */
const SITE_BUDGET_MS = 20_000;

export type CompetitorPage = {
  competitor: string;
  url: string;
  title: string | null;
  text: string;
};

export type CompetitorSearchResult = {
  pages: CompetitorPage[];
  /** Per site: what happened, for the report's scope line. */
  notes: string[];
  warnings: string[];
};

/**
 * Finds a product's cards on competitors' sites through their own search
 * (`competitors.ts`). The list is `SiteSetting uniqueness.competitors`, edited
 * on the detector page; empty = the code's defaults.
 */
@Injectable()
export class CompetitorsService {
  private readonly logger = new Logger(CompetitorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Competitor[]> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (!row) return DEFAULT_COMPETITORS;
    try {
      return parseCompetitors(row.value);
    } catch {
      return DEFAULT_COMPETITORS;
    }
  }

  async settings() {
    const list = await this.list();
    return {
      text: formatCompetitors(list),
      defaults: formatCompetitors(DEFAULT_COMPETITORS),
    };
  }

  /** Saves the list; an empty text goes back to the defaults. */
  async save(text: string) {
    if (!text.trim()) {
      await this.prisma.siteSetting.deleteMany({ where: { key: SETTING_KEY } });
      return this.settings();
    }
    let list: Competitor[];
    try {
      list = parseCompetitors(text);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const value = formatCompetitors(list);
    await this.prisma.siteSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value },
      update: { value },
    });
    return this.settings();
  }

  async search(q: CompetitorQuery): Promise<CompetitorSearchResult> {
    const competitors = await this.list();
    const results = await Promise.all(
      competitors.map((c) => withBudget(this.searchOne(c, q), c)),
    );
    return {
      pages: results.flatMap((r) => r.pages),
      notes: results.map((r) => r.note),
      warnings: results.flatMap((r) => (r.warning ? [r.warning] : [])),
    };
  }

  private async searchOne(
    competitor: Competitor,
    q: CompetitorQuery,
  ): Promise<{ pages: CompetitorPage[]; note: string; warning?: string }> {
    const searchUrl = competitor.search.replace(
      '{q}',
      encodeURIComponent(q.query),
    );
    let links: Array<{ url: string; label: string }>;
    try {
      const page = await fetchPublicPage(searchUrl);
      const found = pickResultLinks(page.body, page.url, q, {
        max: CARDS_PER_COMPETITOR,
        skipHosts: new Set([...ourHosts()].map(bareHost)),
      });
      links = [
        ...found.own.map((url) => ({ url, label: competitor.name })),
        ...found.shops.map((url) => ({
          url,
          label: `${bareHost(new URL(url).hostname)} (через ${competitor.name})`,
        })),
      ];
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`${competitor.name} search: ${message}`);
      return {
        pages: [],
        note: `${competitor.name}: поиск не ответил`,
        warning: `${competitor.name}: поиск не ответил (${message})`,
      };
    }
    if (!links.length) {
      return { pages: [], note: `${competitor.name}: товар не найден` };
    }
    const settled = await Promise.all(
      links.map(({ url, label }) =>
        fetchReadablePage(url, { whole: true }).then(
          (page): CompetitorPage => ({
            competitor: label,
            url,
            title: page.title,
            text: page.text,
          }),
          (error: Error) => {
            this.logger.warn(`${url}: ${error.message}`);
            return null;
          },
        ),
      ),
    );
    const pages = settled.filter((p): p is CompetitorPage => p !== null);
    return {
      pages,
      note: `${competitor.name}: карточек ${pages.length} из ${links.length}`,
    };
  }
}

function withBudget<T extends { pages: CompetitorPage[]; note: string }>(
  work: Promise<T>,
  competitor: Competitor,
): Promise<T | { pages: CompetitorPage[]; note: string; warning: string }> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{
    pages: CompetitorPage[];
    note: string;
    warning: string;
  }>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          pages: [],
          note: `${competitor.name}: не успел`,
          warning: `${competitor.name}: сайт отвечал дольше ${SITE_BUDGET_MS / 1000} с`,
        }),
      SITE_BUDGET_MS,
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
