import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminActionLogService } from '../audit/admin-action-log.service';
import { ErrorLogQueryDto } from './dto/error-log-query.dto';

export type ErrorEntry = {
  statusCode: number;
  method: string;
  path: string;
  kind: string;
  message: string;
  detail?: unknown;
  stack?: string;
  payload?: unknown;
  actorLabel?: string;
  ip?: string;
  userAgent?: string;
};

const DEFAULT_TTL_DAYS = 30;
const DEFAULT_LIMIT = 50;
/** A stack is for finding the line, not for reading the whole call tree. */
const MAX_STACK_CHARS = 4000;
const MAX_MESSAGE_CHARS = 1000;
/**
 * How long the same failure folds into one row. A broken endpoint under load
 * fails on every request; at one row per request the log becomes the incident.
 */
const DEDUPE_WINDOW_MS = 60_000;

@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);
  /** fingerprint → the row it last wrote, so a repeat can bump it. */
  private readonly recent = new Map<string, { id: string; at: number }>();

  constructor(private prisma: PrismaService) {}

  private static fingerprint(entry: ErrorEntry) {
    return [entry.statusCode, entry.method, entry.path, entry.message].join(
      ' ',
    );
  }

  /**
   * Writes one entry, or folds it into the previous identical one.
   *
   * Never throws and never rejects: this runs from the exception filter, where
   * the request has already failed — a failure to *log* the failure must not
   * replace the response the caller was about to get. It is reported to the
   * container log instead, so a silently broken error log is still visible.
   */
  async record(entry: ErrorEntry) {
    try {
      const key = ErrorLogService.fingerprint(entry);
      const now = Date.now();
      const previous = this.recent.get(key);

      if (previous && now - previous.at < DEDUPE_WINDOW_MS) {
        await this.prisma.errorLog.update({
          where: { id: previous.id },
          data: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
        });
        this.recent.set(key, { id: previous.id, at: now });
        return;
      }

      const row = await this.prisma.errorLog.create({
        data: {
          statusCode: entry.statusCode,
          method: entry.method.slice(0, 10),
          path: entry.path.slice(0, 500),
          kind: entry.kind.slice(0, 120),
          message: entry.message.slice(0, MAX_MESSAGE_CHARS),
          detail: AdminActionLogService.preparePayload(entry.detail),
          stack: entry.stack?.slice(0, MAX_STACK_CHARS) ?? null,
          // Same redaction as the audit trail — a password must never land in
          // a table an admin can read.
          payload: AdminActionLogService.preparePayload(entry.payload),
          actorLabel: entry.actorLabel?.slice(0, 200) ?? null,
          ip: entry.ip?.slice(0, 64) ?? null,
          userAgent: entry.userAgent?.slice(0, 300) ?? null,
        },
        select: { id: true },
      });

      this.recent.set(key, { id: row.id, at: now });
      this.forgetStaleFingerprints(now);
    } catch (error) {
      this.logger.error(`Could not record error log entry: ${String(error)}`);
    }
  }

  /** The dedupe map is a cache, not state — it must not grow with traffic. */
  private forgetStaleFingerprints(now: number) {
    if (this.recent.size < 500) return;
    for (const [key, value] of this.recent) {
      if (now - value.at >= DEDUPE_WINDOW_MS) this.recent.delete(key);
    }
  }

  async list(query: ErrorLogQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 200);

    const where: Prisma.ErrorLogWhereInput = {};
    if (query.kind === 'server') where.statusCode = { gte: 500 };
    if (query.kind === 'client') where.statusCode = { gte: 400, lt: 500 };
    if (query.statusCode) where.statusCode = query.statusCode;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { path: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total, serverErrors] = await Promise.all([
      this.prisma.errorLog.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.errorLog.count({ where }),
      // What the badge in the sidebar counts: server errors of the last day.
      this.prisma.errorLog.count({
        where: {
          statusCode: { gte: 500 },
          lastSeenAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      data,
      serverErrors24h: serverErrors,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  }

  /** Empties the log — for after a known incident has been dealt with. */
  async clear() {
    this.recent.clear();
    const { count } = await this.prisma.errorLog.deleteMany({});
    return { removed: count };
  }

  /** Called by the cleanup cron; `ERROR_LOG_TTL_DAYS` defaults to 30. */
  async purgeStale() {
    const days = Number(process.env.ERROR_LOG_TTL_DAYS);
    const ttlDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.errorLog.deleteMany({
      where: { createdAt: { lte: cutoff } },
    });
    if (count) this.logger.log(`Removed ${count} old error log entr(ies)`);
    return count;
  }
}
