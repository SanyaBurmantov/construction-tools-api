import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isOwnHost, trafficSourceLabel } from '../attribution/traffic-source';
import type { PageViewDto } from './traffic.dto';
import { deviceFromAgent, isBotAgent, type Device } from './visitor-agent';
import {
  change,
  dayOfMonth,
  daysInMonth,
  lastMonths,
  monthStart,
  previousMonthToDate,
} from './traffic-periods';

const DEFAULT_TTL_DAYS = 730;
const DEVICES: Device[] = ['mobile', 'desktop', 'tablet'];
/** Minsk calendar keys, matching `traffic-periods.ts`. */
const MINSK = `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Minsk'`;

type DeviceCounts = Record<Device, number>;

const emptyDevices = (): DeviceCounts => ({ mobile: 0, desktop: 0, tablet: 0 });

/**
 * The site's own traffic statistics: visits, unique visitors and page views
 * by month and day, the device mix, where visits come from, and every
 * «Страница не найдена» with the page that linked to it. Metrika has all of
 * this too, but in another account; this is what the shop sees in its own
 * admin. Recording never fails the visitor — a lost view is logged and
 * forgotten.
 */
@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);

  constructor(private readonly prisma: PrismaService) {}

  private ownHosts(requestHost?: string): string[] {
    const hosts = ['gost.by'];
    for (const value of [process.env.PUBLIC_ORIGIN, process.env.CORS_ORIGIN]) {
      for (const origin of (value ?? '').split(',')) {
        try {
          if (origin.trim()) hosts.push(new URL(origin.trim()).hostname);
        } catch {
          /* not a URL */
        }
      }
    }
    if (requestHost) hosts.push(requestHost.split(':')[0]);
    return hosts;
  }

  async record(dto: PageViewDto, userAgent?: string, requestHost?: string) {
    if (isBotAgent(userAgent)) return;
    const path = dto.path.split(/[?#]/)[0].slice(0, 300);
    if (/^\/(admin|api|_)/.test(path)) return;

    let referrerUrl: URL | null = null;
    try {
      referrerUrl = dto.referrer ? new URL(dto.referrer) : null;
    } catch {
      referrerUrl = null;
    }
    const referrerHost = referrerUrl?.hostname.toLowerCase();
    const external =
      referrerHost && !isOwnHost(referrerHost, this.ownHosts(requestHost))
        ? referrerHost
        : undefined;

    const referrer =
      dto.status === 404
        ? referrerUrl
          ? referrerUrl.href.slice(0, 500)
          : null
        : dto.entry
          ? (external ?? null)
          : null;
    const source = dto.entry
      ? trafficSourceLabel({
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          yclid: dto.click === 'yclid' ? '1' : undefined,
          gclid: dto.click === 'gclid' ? '1' : undefined,
          referrer: external,
        }).slice(0, 200)
      : null;

    try {
      await this.prisma.pageView.create({
        data: {
          path,
          status: dto.status,
          isEntry: dto.entry,
          visitorId: dto.visitorId ?? null,
          device: deviceFromAgent(userAgent, dto.touch === true),
          source,
          referrer,
        },
      });
    } catch (error) {
      this.logger.warn(`Page view not saved: ${String(error)}`);
    }
  }

  /** Visits, visitors and views in [from, to). */
  private async totals(from: Date, to: Date) {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        visits: bigint;
        visitors: bigint;
        views: bigint;
        not_found: bigint;
        mobile: bigint;
        desktop: bigint;
        tablet: bigint;
      }>
    >`
      SELECT count(*) FILTER (WHERE "isEntry") AS visits,
             count(DISTINCT "visitorId") AS visitors,
             count(*) AS views,
             count(*) FILTER (WHERE status = 404) AS not_found,
             count(*) FILTER (WHERE "isEntry" AND device = 'mobile') AS mobile,
             count(*) FILTER (WHERE "isEntry" AND device = 'desktop') AS desktop,
             count(*) FILTER (WHERE "isEntry" AND device = 'tablet') AS tablet
      FROM "PageView" WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`;
    return {
      visits: Number(row?.visits ?? 0),
      visitors: Number(row?.visitors ?? 0),
      views: Number(row?.views ?? 0),
      notFound: Number(row?.not_found ?? 0),
      devices: {
        mobile: Number(row?.mobile ?? 0),
        desktop: Number(row?.desktop ?? 0),
        tablet: Number(row?.tablet ?? 0),
      } as DeviceCounts,
    };
  }

  /**
   * The headline: this month so far against the same stretch of last month,
   * and the whole of last month. Cheap — the dashboard asks for it too.
   */
  async summary(now = new Date()) {
    const thisMonthFrom = monthStart(now, 0);
    const prev = previousMonthToDate(now);
    const [current, previousToDate, previousMonth, last30] = await Promise.all([
      this.totals(thisMonthFrom, now),
      this.totals(prev.from, prev.to),
      this.totals(monthStart(now, -1), thisMonthFrom),
      this.totals(new Date(now.getTime() - 30 * 86_400_000), now),
    ]);
    return {
      day: dayOfMonth(now),
      current,
      previousToDate,
      previousMonth,
      last30,
      change: {
        visits: change(current.visits, previousToDate.visits),
        visitors: change(current.visitors, previousToDate.visitors),
        views: change(current.views, previousToDate.views),
      },
    };
  }

  /** The `/admin/traffic` screen. */
  async report(now = new Date()) {
    const months = lastMonths(now, 12);
    const yearFrom = monthStart(now, -11);
    const prevFrom = monthStart(now, -1);
    const since30 = new Date(now.getTime() - 30 * 86_400_000);

    const [
      summary,
      monthly,
      monthlyDevices,
      daily,
      sources,
      landings,
      pages,
      notFound,
      recent404,
    ] = await Promise.all([
      this.summary(now),
      this.prisma.$queryRawUnsafe<
        Array<{
          month: string;
          visits: bigint;
          visitors: bigint;
          views: bigint;
          not_found: bigint;
        }>
      >(
        `SELECT to_char("createdAt" ${MINSK}, 'YYYY-MM') AS month,
                  count(*) FILTER (WHERE "isEntry") AS visits,
                  count(DISTINCT "visitorId") AS visitors,
                  count(*) AS views,
                  count(*) FILTER (WHERE status = 404) AS not_found
           FROM "PageView" WHERE "createdAt" >= $1
           GROUP BY 1`,
        yearFrom,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{ month: string; device: string; visits: bigint }>
      >(
        `SELECT to_char("createdAt" ${MINSK}, 'YYYY-MM') AS month, device,
                  count(*) AS visits
           FROM "PageView" WHERE "createdAt" >= $1 AND "isEntry"
           GROUP BY 1, 2`,
        yearFrom,
      ),
      this.prisma.$queryRawUnsafe<Array<{ day: string; visits: bigint }>>(
        `SELECT to_char("createdAt" ${MINSK}, 'YYYY-MM-DD') AS day,
                  count(*) FILTER (WHERE "isEntry") AS visits
           FROM "PageView" WHERE "createdAt" >= $1
           GROUP BY 1`,
        prevFrom,
      ),
      this.prisma.$queryRaw<Array<{ source: string; visits: bigint }>>`
          SELECT coalesce(source, 'direct') AS source, count(*) AS visits
          FROM "PageView" WHERE "createdAt" >= ${since30} AND "isEntry"
          GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      this.prisma.$queryRaw<Array<{ path: string; visits: bigint }>>`
          SELECT path, count(*) AS visits
          FROM "PageView" WHERE "createdAt" >= ${since30} AND "isEntry"
          GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      this.prisma.$queryRaw<Array<{ path: string; views: bigint }>>`
          SELECT path, count(*) AS views
          FROM "PageView" WHERE "createdAt" >= ${since30} AND status = 200
          GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      this.prisma.$queryRaw<
        Array<{
          path: string;
          views: bigint;
          visitors: bigint;
          referrer: string | null;
          last_at: Date;
        }>
      >`
          SELECT path, count(*) AS views, count(DISTINCT "visitorId") AS visitors,
                 (array_agg(referrer ORDER BY "createdAt" DESC) FILTER (WHERE referrer IS NOT NULL))[1] AS referrer,
                 max("createdAt") AS last_at
          FROM "PageView" WHERE "createdAt" >= ${since30} AND status = 404
          GROUP BY 1 ORDER BY 2 DESC, 5 DESC LIMIT 100`,
      this.prisma.pageView.findMany({
        where: { status: 404 },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          path: true,
          referrer: true,
          device: true,
          isEntry: true,
        },
      }),
    ]);

    const byMonth = new Map(
      months.map((key) => [
        key,
        {
          month: key,
          visits: 0,
          visitors: 0,
          views: 0,
          notFound: 0,
          devices: emptyDevices(),
        },
      ]),
    );
    for (const row of monthly) {
      const entry = byMonth.get(row.month);
      if (!entry) continue;
      entry.visits = Number(row.visits);
      entry.visitors = Number(row.visitors);
      entry.views = Number(row.views);
      entry.notFound = Number(row.not_found);
    }
    for (const row of monthlyDevices) {
      const entry = byMonth.get(row.month);
      if (entry && DEVICES.includes(row.device as Device)) {
        entry.devices[row.device as Device] = Number(row.visits);
      }
    }

    const visitsByDay = new Map(daily.map((r) => [r.day, Number(r.visits)]));
    const dayKey = (offset: number, day: number) => {
      const start = monthStart(now, offset);
      const d = new Date(start.getTime() + 3 * 3_600_000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    const today = dayOfMonth(now);
    const currentDays = Array.from({ length: daysInMonth(now, 0) }, (_, i) => ({
      day: i + 1,
      visits: i + 1 <= today ? (visitsByDay.get(dayKey(0, i + 1)) ?? 0) : null,
    }));
    const previousDays = Array.from(
      { length: daysInMonth(now, -1) },
      (_, i) => ({
        day: i + 1,
        visits: visitsByDay.get(dayKey(-1, i + 1)) ?? 0,
      }),
    );

    return {
      generatedAt: now,
      summary,
      months: [...byMonth.values()],
      days: {
        current: { month: months[months.length - 1], days: currentDays },
        previous: { month: months[months.length - 2], days: previousDays },
      },
      sources: sources.map((r) => ({
        source: r.source,
        visits: Number(r.visits),
      })),
      landings: landings.map((r) => ({
        path: r.path,
        visits: Number(r.visits),
      })),
      pages: pages.map((r) => ({ path: r.path, views: Number(r.views) })),
      notFound: notFound.map((r) => ({
        path: r.path,
        views: Number(r.views),
        visitors: Number(r.visitors),
        referrer: r.referrer,
        lastAt: r.last_at,
      })),
      recentNotFound: recent404,
    };
  }

  /** Nightly: keeps `TRAFFIC_LOG_TTL_DAYS` (730 — two years, for a year-on-year look). */
  async purgeOld() {
    const days = Number(process.env.TRAFFIC_LOG_TTL_DAYS) || DEFAULT_TTL_DAYS;
    const { count } = await this.prisma.pageView.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
    });
    if (count) this.logger.log(`Traffic log: ${count} old page views removed`);
    return count;
  }
}
