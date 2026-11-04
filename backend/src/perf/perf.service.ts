import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { servesHttp } from '../common/utils/process-role';
import {
  N_PLUS_ONE_QUERIES,
  RequestStats,
  routeTemplate,
  SLOW_REQUEST_MS,
} from './request-stats';

/** Alert when this many requests took over SLOW_REQUEST_MS in the window. */
const ALERT_SLOW_COUNT = Number(process.env.PERF_ALERT_SLOW_COUNT) || 20;
const ALERT_WINDOW_MS = 5 * 60_000;
const ALERT_EVERY_MS = 60 * 60_000;

type StatementRow = {
  queryid: string;
  calls: bigint;
  total_ms: number;
  mean_ms: number;
  max_ms: number;
  rows: bigint;
  hit_ratio: number | null;
  query: string;
};

/**
 * «Скорость» in the admin (`/admin/performance`): how fast the API answers
 * per route (in this process's memory), which SQL costs the database most
 * (pg_stat_statements), and the database's own vital signs. Plus a Telegram
 * alert when the site turns slow, so «тормозит» is noticed before a customer
 * says it.
 */
@Injectable()
export class PerfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PerfService.name);
  private readonly stats = new RequestStats();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAlertAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  onModuleInit() {
    // The worker serves no HTTP: nothing to time, nothing to alert on.
    if (!servesHttp()) return;
    this.timer = setInterval(() => void this.checkSlow(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  record(req: Request, status: number, ms: number, queries = 0) {
    this.stats.record({
      method: req.method,
      route: routeTemplate(req),
      url: req.originalUrl ?? req.url,
      status,
      ms,
      queries,
    });
  }

  requests() {
    return {
      since: this.stats.since,
      slowThresholdMs: SLOW_REQUEST_MS,
      routes: this.stats.routesTable(),
      slow: this.stats.recentSlow(),
      slo: this.stats.sloReport(),
      nPlusOneThreshold: N_PLUS_ONE_QUERIES,
    };
  }

  resetRequests() {
    this.stats.reset();
    return this.requests();
  }

  private async checkSlow() {
    const slow = this.stats.slowInWindow(ALERT_WINDOW_MS);
    if (slow < ALERT_SLOW_COUNT) return;
    if (Date.now() - this.lastAlertAt < ALERT_EVERY_MS) return;
    this.lastAlertAt = Date.now();
    const routes = this.stats.slowRoutesInWindow(ALERT_WINDOW_MS).slice(0, 5);
    const lines = [
      `За 5 минут ${slow} запросов дольше ${SLOW_REQUEST_MS / 1000} с.`,
      ...routes.map(
        (r) =>
          `• ${r.route} — ${r.count} шт., до ${(r.maxMs / 1000).toFixed(1)} с`,
      ),
    ];
    const db = await this.longRunning().catch(() => []);
    if (db.length) {
      lines.push(`В базе сейчас ${db.length} запрос(ов) дольше 1 с.`);
    }
    await this.telegram.notifySlowSite(lines).catch(() => undefined);
  }

  /** Statements running longer than a second right now. */
  private longRunning() {
    return this.prisma.$queryRaw<
      Array<{ pid: number; seconds: number; state: string; query: string }>
    >`
      SELECT pid, extract(epoch FROM now() - query_start)::float AS seconds,
             state, left(regexp_replace(query, '\\s+', ' ', 'g'), 600) AS query
      FROM pg_stat_activity
      WHERE datname = current_database() AND state <> 'idle'
        AND pid <> pg_backend_pid() AND now() - query_start > interval '1 second'
      ORDER BY query_start
      LIMIT 20`;
  }

  /**
   * The database side. `sort` picks the statement ranking: total time (what
   * loads the server most), mean time (what makes one request slow) or calls.
   */
  async database(sort: 'total' | 'mean' | 'calls' = 'total') {
    const order =
      sort === 'mean'
        ? 'mean_exec_time'
        : sort === 'calls'
          ? 'calls'
          : 'total_exec_time';
    let statements: StatementRow[] = [];
    let statementsError: string | null = null;
    let statementsSince: Date | null = null;
    let totalMs = 0;
    try {
      statements = await this.prisma.$queryRawUnsafe<StatementRow[]>(`
        SELECT queryid::text AS queryid, calls, total_exec_time AS total_ms,
               mean_exec_time AS mean_ms, max_exec_time AS max_ms, rows,
               CASE WHEN shared_blks_hit + shared_blks_read > 0
                 THEN shared_blks_hit::float / (shared_blks_hit + shared_blks_read)
               END AS hit_ratio,
               left(regexp_replace(query, '\\s+', ' ', 'g'), 4000) AS query
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY ${order} DESC
        LIMIT 40`);
      const [info] = await this.prisma.$queryRaw<
        Array<{ since: Date | null; total: number | null }>
      >`
        SELECT (SELECT stats_reset FROM pg_stat_statements_info) AS since,
               (SELECT sum(total_exec_time) FROM pg_stat_statements
                 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()))::float AS total`;
      statementsSince = info?.since ?? null;
      totalMs = info?.total ?? 0;
    } catch (error) {
      // Extension not created yet, or the server was not restarted with the
      // library: the rest of the screen still works.
      statementsError = error instanceof Error ? error.message : String(error);
    }

    const [overview] = await this.prisma.$queryRaw<
      Array<{
        size: string;
        hit_ratio: number | null;
        commits: bigint;
        rollbacks: bigint;
        deadlocks: bigint;
        temp_bytes: string;
      }>
    >`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
             blks_hit::float / nullif(blks_hit + blks_read, 0) AS hit_ratio,
             xact_commit AS commits, xact_rollback AS rollbacks, deadlocks,
             pg_size_pretty(temp_bytes) AS temp_bytes
      FROM pg_stat_database WHERE datname = current_database()`;
    const connections = await this.prisma.$queryRaw<
      Array<{ state: string; count: bigint }>
    >`
      SELECT coalesce(state, 'другое') AS state, count(*) AS count
      FROM pg_stat_activity WHERE datname = current_database()
      GROUP BY 1 ORDER BY 2 DESC`;
    const tables = await this.prisma.$queryRaw<
      Array<{
        table: string;
        rows: bigint;
        seq_scan: bigint;
        seq_tup_read: bigint;
        idx_scan: bigint | null;
        dead: bigint;
        size: string;
        last_autovacuum: Date | null;
      }>
    >`
      SELECT relname AS "table", n_live_tup AS rows, seq_scan, seq_tup_read,
             idx_scan, n_dead_tup AS dead,
             pg_size_pretty(pg_total_relation_size(relid)) AS size,
             greatest(last_autovacuum, last_vacuum) AS last_autovacuum
      FROM pg_stat_user_tables
      ORDER BY seq_tup_read DESC
      LIMIT 15`;
    const running = await this.longRunning();

    return {
      statements: statements.map((row) => ({
        queryid: row.queryid,
        calls: Number(row.calls),
        totalMs: Math.round(row.total_ms),
        meanMs: Math.round(row.mean_ms * 10) / 10,
        maxMs: Math.round(row.max_ms),
        rows: Number(row.rows),
        hitRatio: row.hit_ratio,
        share: totalMs > 0 ? row.total_ms / totalMs : null,
        query: row.query,
      })),
      statementsError,
      statementsSince,
      overview: overview && {
        size: overview.size,
        hitRatio: overview.hit_ratio,
        commits: Number(overview.commits),
        rollbacks: Number(overview.rollbacks),
        deadlocks: Number(overview.deadlocks),
        tempBytes: overview.temp_bytes,
      },
      connections: connections.map((c) => ({
        state: c.state,
        count: Number(c.count),
      })),
      tables: tables.map((t) => ({
        table: t.table,
        rows: Number(t.rows),
        seqScan: Number(t.seq_scan),
        seqTupRead: Number(t.seq_tup_read),
        idxScan: t.idx_scan === null ? null : Number(t.idx_scan),
        dead: Number(t.dead),
        size: t.size,
        lastVacuum: t.last_autovacuum,
      })),
      running,
    };
  }

  /** Starts the statement statistics over (e.g. after an optimisation). */
  async resetDatabase() {
    await this.prisma.$queryRaw`SELECT pg_stat_statements_reset()`;
    this.logger.log('pg_stat_statements reset');
    return this.database();
  }
}
