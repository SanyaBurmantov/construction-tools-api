import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';

export type AdminActionEntry = {
  actorId?: string;
  actorLabel: string;
  method: string;
  path: string;
  statusCode: number;
  payload?: unknown;
  ip?: string;
  durationMs?: number;
};

/** Anything whose name suggests a secret never reaches the log. */
const SECRET_KEY = /(password|token|secret|passwordHash|authorization)/i;
/** The log is evidence of what changed, not a replayable request body. */
const MAX_PAYLOAD_CHARS = 4000;
const DEFAULT_TTL_DAYS = 180;
const DEFAULT_LIMIT = 50;

@Injectable()
export class AdminActionLogService {
  private readonly logger = new Logger(AdminActionLogService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Copies a request body with secrets replaced and the result bounded.
   *
   * Pure and exported through the service so it is testable on its own: the
   * one thing that must never regress here is a password ending up in a table
   * an admin can read.
   */
  static redact(value: unknown, depth = 0): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (depth > 4) return '[deep]';

    if (Array.isArray(value)) {
      // Bulk imports can carry thousands of rows; the shape is what matters.
      const head = value
        .slice(0, 20)
        .map((item) => this.redact(item, depth + 1));
      return value.length > 20
        ? [...head, `[+${value.length - 20} more]`]
        : head;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SECRET_KEY.test(key)
        ? '[redacted]'
        : this.redact(item, depth + 1);
    }
    return result;
  }

  /** Redacted, size-bounded JSON, or undefined when there is nothing to keep. */
  static preparePayload(body: unknown): Prisma.InputJsonValue | undefined {
    if (body == null || (typeof body === 'object' && !Object.keys(body).length))
      return undefined;

    const redacted = this.redact(body);
    const serialized = JSON.stringify(redacted);
    if (serialized == null) return undefined;
    if (serialized.length <= MAX_PAYLOAD_CHARS)
      return redacted as Prisma.InputJsonValue;

    return {
      truncated: true,
      preview: serialized.slice(0, MAX_PAYLOAD_CHARS),
    };
  }

  /**
   * Writes one entry. Never throws: an audit write that fails must not turn a
   * successful admin action into an error response — it is logged instead, so
   * a silently broken log is still visible in the container output.
   */
  async record(entry: AdminActionEntry) {
    try {
      await this.prisma.adminActionLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorLabel: entry.actorLabel,
          method: entry.method,
          path: entry.path.slice(0, 500),
          statusCode: entry.statusCode,
          payload: AdminActionLogService.preparePayload(entry.payload),
          ip: entry.ip?.slice(0, 64) ?? null,
          durationMs: entry.durationMs ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not record admin action ${entry.method} ${entry.path}: ${String(error)}`,
      );
    }
  }

  async list(query: AuditQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 200);

    const where: Prisma.AdminActionLogWhereInput = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.method) where.method = query.method.toUpperCase();
    if (query.path?.trim())
      where.path = { contains: query.path.trim(), mode: 'insensitive' };
    if (query.onlyFailures) where.statusCode = { gte: 400 };

    const [data, total] = await Promise.all([
      this.prisma.adminActionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: { select: { id: true, login: true, role: true } },
        },
      }),
      this.prisma.adminActionLog.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  }

  /** Called by the cleanup cron; `ADMIN_LOG_TTL_DAYS` defaults to 180. */
  async purgeStale() {
    const days = Number(process.env.ADMIN_LOG_TTL_DAYS);
    const ttlDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.adminActionLog.deleteMany({
      where: { createdAt: { lte: cutoff } },
    });
    if (count) this.logger.log(`Removed ${count} old audit entr(ies)`);
    return count;
  }
}
