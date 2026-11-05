import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import {
  labelledRows,
  monthsFromBytime,
  notFoundRows,
  pathRows,
  periodTotals,
  visitsByDay,
  type MetrikaBytimeResponse,
  type MetrikaDataResponse,
} from './metrika-report';
import {
  change,
  dayOfMonth,
  daysInMonth,
  lastMonths,
  minskDate,
  monthStart,
  previousMonthToDate,
} from './traffic-periods';

const API = 'https://api-metrika.yandex.net';
/** The storefront's counter (`nuxt.config.ts` → YANDEX_METRIKA_ID). */
const DEFAULT_COUNTER_ID = '113800110';
const TOKEN_KEY = 'metrika.token';
const COUNTER_KEY = 'metrika.counterId';
const CACHE_MS = 15 * 60_000;
/** Pageviews of our «Страница не найдена | Gost.by» (error.vue's title). */
const NOT_FOUND_FILTER = "ym:pv:title=@'не найден'";
/**
 * People only. Metrika marks robots itself (headless Chrome from data
 * centres — 1 299 of 1 780 visits in the counter's first ten days, and 260 of
 * the 301 visits that hit a 404). Every number is counted without them.
 * Lists of addresses cannot be: with this filter Metrika hides every URL row
 * below its privacy threshold (only the home page survives), so landing
 * pages, popular pages and the 404 list are read unfiltered and the screen
 * says so (`urlListsIncludeRobots`).
 */
const HUMANS_S = "ym:s:isRobot=='No'";
const HUMANS_PV = "ym:pv:isRobot=='No'";
const and = (...filters: string[]) => filters.join(' AND ');

class MetrikaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Settings = { token: string | null; counterId: string };

/**
 * The same `/admin/traffic` report, read from Yandex Metrika instead of our
 * own counter — Metrika has the history from before 2026-11-05 and counts
 * the way the owner already looks at it. Read-only (OAuth scope
 * `metrika:read`). The token lives in `SiteSetting metrika.token` (pasted
 * on the screen, checked against the counter before it is kept, never sent
 * back) or `METRIKA_TOKEN`. Each block is its own request, so one Metrika
 * refuses leaves the rest of the screen; the whole answer is cached 15 min
 * in the API process (≈ 15 requests per refresh, far below the API quota).
 */
@Injectable()
export class MetrikaService {
  private readonly logger = new Logger(MetrikaService.name);
  private cache: { at: number; value: unknown } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async settings(): Promise<Settings> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { in: [TOKEN_KEY, COUNTER_KEY] } },
    });
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    return {
      token: stored.get(TOKEN_KEY) || process.env.METRIKA_TOKEN || null,
      counterId:
        stored.get(COUNTER_KEY) ||
        process.env.METRIKA_COUNTER_ID ||
        DEFAULT_COUNTER_ID,
    };
  }

  private async get<T>(
    token: string,
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const res = await fetchWithTimeout(
      `${API}${path}?${query}`,
      { headers: { Authorization: `OAuth ${token}` } },
      { timeoutMs: 20_000, retries: 1 },
    );
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    if (!res.ok) {
      throw new MetrikaError(body?.message || `HTTP ${res.status}`, res.status);
    }
    return body as T;
  }

  /** What the screen shows next to the switch: connected or not, which counter. */
  async status() {
    const { token, counterId } = await this.settings();
    if (!token) return { configured: false, counterId };
    try {
      const info = await this.get<{
        counter?: { name?: string; site?: string };
      }>(token, `/management/v1/counter/${counterId}`, {});
      return {
        configured: true,
        counterId,
        counterName: info.counter?.name ?? info.counter?.site ?? null,
        tokenHint: `…${token.slice(-4)}`,
      };
    } catch (error) {
      return {
        configured: true,
        counterId,
        tokenHint: `…${token.slice(-4)}`,
        error: this.describe(error),
      };
    }
  }

  /** Keeps a token only after Metrika confirmed it can read the counter. */
  async saveToken(rawToken: string) {
    const token = rawToken.trim().replace(/^OAuth\s+/i, '');
    if (!/^[A-Za-z0-9._-]{20,200}$/.test(token)) {
      throw new BadRequestException('Это не похоже на OAuth-токен Яндекса');
    }
    const { counterId } = await this.settings();
    try {
      await this.get(token, `/management/v1/counter/${counterId}`, {});
    } catch (error) {
      throw new BadRequestException(
        `Метрика не приняла токен: ${this.describe(error)}`,
      );
    }
    await this.prisma.siteSetting.upsert({
      where: { key: TOKEN_KEY },
      create: { key: TOKEN_KEY, value: token },
      update: { value: token },
    });
    this.cache = null;
    return this.status();
  }

  async removeToken() {
    await this.prisma.siteSetting.deleteMany({ where: { key: TOKEN_KEY } });
    this.cache = null;
    return this.status();
  }

  private describe(error: unknown): string {
    if (error instanceof MetrikaError) {
      if (error.status === 401) return 'токен недействителен или отозван';
      if (error.status === 403)
        return 'у этого аккаунта нет доступа к счётчику';
      return error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  /** The `/admin/traffic` report from Metrika, same shape as our own. */
  async report(refresh = false, now = new Date()) {
    const { token, counterId } = await this.settings();
    if (!token) return { configured: false as const, counterId };
    if (!refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.value;
    }

    const warnings: string[] = [];
    const base = { ids: counterId, accuracy: 'full', lang: 'ru' };
    const today = minskDate(now);
    const thisMonthFrom = minskDate(monthStart(now, 0));
    const prevMonthFrom = minskDate(monthStart(now, -1));
    const prevMonthTo = minskDate(new Date(monthStart(now, 0).getTime() - 1));
    const prevToDate = previousMonthToDate(now);
    const prevToDateTo = minskDate(new Date(prevToDate.to.getTime() - 1));
    const yearFrom = minskDate(monthStart(now, -11));
    const last30From = minskDate(new Date(now.getTime() - 29 * 86_400_000));
    const months = lastMonths(now, 12);

    const attempt = async <T>(
      label: string,
      run: () => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        if (error instanceof MetrikaError && error.status === 401) throw error;
        warnings.push(`${label}: ${this.describe(error)}`);
        this.logger.warn(`Metrika ${label}: ${this.describe(error)}`);
        return fallback;
      }
    };

    const period = (date1: string, date2: string) =>
      attempt(
        `период ${date1}–${date2}`,
        async () => {
          const [visits, notFound] = await Promise.all([
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1,
              date2,
              metrics: 'ym:s:visits,ym:s:users,ym:s:pageviews',
              dimensions: 'ym:s:deviceCategory',
              filters: HUMANS_S,
            }),
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1,
              date2,
              metrics: 'ym:pv:pageviews',
              filters: and(NOT_FOUND_FILTER, HUMANS_PV),
            }).catch(() => ({ totals: [0] }) as MetrikaDataResponse),
          ]);
          return {
            ...periodTotals(visits),
            notFound: Math.round(notFound.totals?.[0] ?? 0),
          };
        },
        {
          visits: 0,
          visitors: 0,
          views: 0,
          notFound: 0,
          devices: { mobile: 0, desktop: 0, tablet: 0 },
        },
      );

    try {
      const [current, previousToDate, previousMonth, last30] =
        await Promise.all([
          period(thisMonthFrom, today),
          period(prevMonthFrom, prevToDateTo),
          period(prevMonthFrom, prevMonthTo),
          period(last30From, today),
        ]);

      const [
        byMonth,
        notFoundByMonth,
        daily,
        notFoundList,
        sources,
        landings,
        pages,
        robots,
      ] = await Promise.all([
        attempt(
          'по месяцам',
          () =>
            this.get<MetrikaBytimeResponse>(token, '/stat/v1/data/bytime', {
              ...base,
              date1: yearFrom,
              date2: today,
              group: 'month',
              metrics: 'ym:s:visits,ym:s:users,ym:s:pageviews',
              dimensions: 'ym:s:deviceCategory',
              filters: HUMANS_S,
            }),
          {} as MetrikaBytimeResponse,
        ),
        attempt(
          '«не найдено» по месяцам',
          () =>
            this.get<MetrikaBytimeResponse>(token, '/stat/v1/data/bytime', {
              ...base,
              date1: yearFrom,
              date2: today,
              group: 'month',
              metrics: 'ym:pv:pageviews',
              filters: and(NOT_FOUND_FILTER, HUMANS_PV),
            }),
          {} as MetrikaBytimeResponse,
        ),
        attempt(
          'по дням',
          () =>
            this.get<MetrikaBytimeResponse>(token, '/stat/v1/data/bytime', {
              ...base,
              date1: prevMonthFrom,
              date2: today,
              group: 'day',
              metrics: 'ym:s:visits',
              filters: HUMANS_S,
            }),
          {} as MetrikaBytimeResponse,
        ),
        attempt(
          '«не найдено»',
          () =>
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1: last30From,
              date2: today,
              metrics: 'ym:pv:pageviews',
              dimensions: 'ym:pv:URL,ym:pv:referer',
              filters: NOT_FOUND_FILTER,
              sort: '-ym:pv:pageviews',
              limit: 500,
            }),
          {} as MetrikaDataResponse,
        ),
        attempt(
          'источники',
          () =>
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1: last30From,
              date2: today,
              metrics: 'ym:s:visits',
              dimensions: 'ym:s:lastTrafficSource,ym:s:lastSourceEngine',
              filters: HUMANS_S,
              sort: '-ym:s:visits',
              limit: 50,
            }),
          {} as MetrikaDataResponse,
        ),
        attempt(
          'страницы входа',
          () =>
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1: last30From,
              date2: today,
              metrics: 'ym:s:visits',
              dimensions: 'ym:s:startURL',
              sort: '-ym:s:visits',
              limit: 100,
            }),
          {} as MetrikaDataResponse,
        ),
        attempt(
          'страницы',
          () =>
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1: last30From,
              date2: today,
              metrics: 'ym:pv:pageviews',
              dimensions: 'ym:pv:URL',
              sort: '-ym:pv:pageviews',
              limit: 100,
            }),
          {} as MetrikaDataResponse,
        ),
        attempt(
          'роботы',
          () =>
            this.get<MetrikaDataResponse>(token, '/stat/v1/data', {
              ...base,
              date1: last30From,
              date2: today,
              metrics: 'ym:s:visits',
              filters: "ym:s:isRobot=='Yes'",
            }),
          {} as MetrikaDataResponse,
        ),
      ]);

      const dayVisits = visitsByDay(daily);
      const dayKey = (offset: number, day: number) =>
        `${minskDate(monthStart(now, offset)).slice(0, 8)}${String(day).padStart(2, '0')}`;
      const todayNumber = dayOfMonth(now);

      const value = {
        configured: true as const,
        source: 'metrika' as const,
        counterId,
        generatedAt: now,
        warnings,
        /** Visits Metrika marked as robots over 30 days — left out of every number. */
        robotVisits30: Math.round(robots.totals?.[0] ?? 0),
        urlListsIncludeRobots: true,
        summary: {
          day: todayNumber,
          current,
          previousToDate,
          previousMonth,
          last30,
          change: {
            visits: change(current.visits, previousToDate.visits),
            visitors: change(current.visitors, previousToDate.visitors),
            views: change(current.views, previousToDate.views),
          },
        },
        months: monthsFromBytime(months, byMonth, notFoundByMonth),
        days: {
          current: {
            month: months[months.length - 1],
            days: Array.from({ length: daysInMonth(now, 0) }, (_, i) => ({
              day: i + 1,
              visits:
                i + 1 <= todayNumber
                  ? (dayVisits.get(dayKey(0, i + 1)) ?? 0)
                  : null,
            })),
          },
          previous: {
            month: months[months.length - 2],
            days: Array.from({ length: daysInMonth(now, -1) }, (_, i) => ({
              day: i + 1,
              visits: dayVisits.get(dayKey(-1, i + 1)) ?? 0,
            })),
          },
        },
        sources: labelledRows(sources).map((r) => ({
          source: r.label,
          visits: r.value,
        })),
        landings: pathRows(landings).map((r) => ({
          path: r.path,
          visits: r.value,
        })),
        pages: pathRows(pages).map((r) => ({ path: r.path, views: r.value })),
        notFound: notFoundRows(notFoundList),
        recentNotFound: [],
      };
      this.cache = { at: Date.now(), value };
      return value;
    } catch (error) {
      return {
        configured: true as const,
        source: 'metrika' as const,
        counterId,
        error: this.describe(error),
      };
    }
  }
}
