import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runsBackgroundJobs } from '../common/utils/process-role';
import {
  JobOutcome,
  JobParams,
  JobRunResult,
  ParserJobsService,
} from './parser-jobs.service';
import { readWorkerHeartbeat } from './worker-heartbeat';

/** How often the worker looks for new requests. */
const POLL_EVERY_MS = 3_000;
/** How often a waiting API request re-reads its row. */
const WAIT_POLL_MS = 2_000;
/**
 * The longest a synchronous `/admin/queue/*` button waits. A tools.by crawl
 * runs ~15 minutes; past this the job keeps running in the worker and the
 * caller gets a 504 that says so.
 */
const WAIT_TIMEOUT_MS = 20 * 60_000;
/** A request no worker claimed in this long is dropped rather than run late. */
const UNCLAIMED_EXPIRY_MS = 30 * 60_000;
/** Finished requests are kept this long, for debugging, then deleted. */
const KEEP_FINISHED_MS = 7 * 24 * 3_600_000;
const PRUNE_EVERY_MS = 3_600_000;

/**
 * The bridge between the API process and the worker for parser jobs an admin
 * starts by hand.
 *
 * The API never parses (it would put a supplier crawl back into the process
 * that serves the storefront, and run it outside the worker's per-source
 * lock). It writes a `ParserJobRequest`; the worker claims it with a
 * conditional update, runs it through `ParserJobsService.runRequested()` —
 * queued behind the source lock like a cron job — and records the outcome.
 *
 * In a single process (`PROCESS_ROLE` unset: dev, tests) there is no worker
 * to hand over to, and the job runs in place exactly as it did before.
 */
@Injectable()
export class ParserJobRequestService {
  private readonly logger = new Logger(ParserJobRequestService.name);
  private polling = false;
  private lastPruneAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ParserJobsService,
  ) {}

  /* ------------------------------------------------------ API side ---- */

  /** Starts a job and answers at once (the jobs panel polls for progress). */
  async start(
    code: string,
    jobName: string,
    params?: JobParams,
  ): Promise<JobRunResult> {
    if (runsBackgroundJobs()) return this.jobs.start(code, jobName, params);

    const key = `${code}-${jobName}`;
    if (!this.jobs.findJob(code, jobName)) {
      return { started: false, key, reason: 'unknown-job' };
    }
    const busy = await this.busyKey(code);
    if (busy) return { started: false, key: busy, reason: 'already-running' };

    await this.ensureWorkerAlive();
    await this.create(code, jobName, params);
    return { started: true, key };
  }

  /**
   * Runs a job and waits for it — the contract of the old synchronous
   * `/admin/queue/*` buttons, which the runbook's curl commands rely on.
   * 409 when the source is busy, as before.
   */
  async runAndWait(
    code: string,
    jobName: string,
    params?: JobParams,
  ): Promise<unknown> {
    const key = `${code}-${jobName}`;
    const job = this.jobs.findJob(code, jobName);
    if (!job) throw new BadRequestException(`Unknown job ${key}`);

    if (runsBackgroundJobs()) {
      return this.jobs.runExclusive(code, jobName, job.label, () =>
        job.run(params),
      );
    }

    const busy = await this.busyKey(code);
    if (busy) {
      throw new ConflictException(
        `Сейчас выполняется задание ${busy} — дождитесь его окончания`,
      );
    }
    await this.ensureWorkerAlive();
    const { id } = await this.create(code, jobName, params);

    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
      const row = await this.prisma.parserJobRequest.findUnique({
        where: { id },
        select: { status: true, result: true, error: true },
      });
      if (!row) break;
      if (row.status === 'DONE') return row.result;
      if (row.status === 'FAILED') {
        throw new InternalServerErrorException(
          row.error ?? `Задание ${key} завершилось ошибкой`,
        );
      }
    }
    throw new GatewayTimeoutException(
      `Задание ${key} ещё выполняется в воркере — результат появится в /admin/parsing`,
    );
  }

  /** Requests for this key the worker has not finished yet. */
  async hasOpenRequest(code: string, jobName: string): Promise<boolean> {
    const count = await this.prisma.parserJobRequest.count({
      where: {
        sourceCode: code,
        jobName,
        status: { in: ['PENDING', 'TAKEN'] },
      },
    });
    return count > 0;
  }

  /**
   * The API's view of the source lock, which lives in the worker's memory:
   * a job marked running or waiting, or a request not finished yet.
   */
  private async busyKey(code: string): Promise<string | undefined> {
    const [status, request] = await Promise.all([
      this.prisma.parserRuntimeStatus.findFirst({
        where: {
          key: { startsWith: `${code}-` },
          OR: [{ isRunning: true }, { waitingSince: { not: null } }],
        },
        select: { key: true },
      }),
      this.prisma.parserJobRequest.findFirst({
        where: { sourceCode: code, status: { in: ['PENDING', 'TAKEN'] } },
        select: { jobName: true },
      }),
    ]);
    if (status) return status.key;
    if (request) return `${code}-${request.jobName}`;
    return undefined;
  }

  /** A request nobody will pick up should fail now, not after 20 minutes. */
  private async ensureWorkerAlive() {
    const worker = await readWorkerHeartbeat(this.prisma);
    if (!worker.alive) {
      throw new ServiceUnavailableException(
        'Воркер парсеров не отвечает — задание не может быть запущено',
      );
    }
  }

  private create(code: string, jobName: string, params?: JobParams) {
    return this.prisma.parserJobRequest.create({
      data: {
        sourceCode: code,
        jobName,
        params: params ? (params as Prisma.InputJsonObject) : Prisma.DbNull,
      },
      select: { id: true },
    });
  }

  /* --------------------------------------------------- worker side ---- */

  /**
   * Claims new requests. `@Interval` only fires where `ScheduleModule` is
   * loaded — the worker (or a single dev process), never the API.
   */
  @Interval(POLL_EVERY_MS)
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.expireUnclaimed();
      const requests = await this.prisma.parserJobRequest.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      for (const request of requests) {
        const claimed = await this.prisma.parserJobRequest.updateMany({
          where: { id: request.id, status: 'PENDING' },
          data: { status: 'TAKEN', takenAt: new Date() },
        });
        if (!claimed.count) continue;
        // Not awaited: a request may queue behind a 15-minute batch, and the
        // next ones (other sources) must not wait for it.
        void this.handle(
          request.id,
          request.sourceCode,
          request.jobName,
          toParams(request.params),
        );
      }
      await this.pruneFinished();
    } catch (error) {
      this.logger.error(`Request poll failed: ${errorMessage(error)}`);
    } finally {
      this.polling = false;
    }
  }

  private async handle(
    id: string,
    code: string,
    jobName: string,
    params?: JobParams,
  ) {
    let outcome: JobOutcome;
    try {
      outcome = await this.jobs.runRequested(code, jobName, params);
    } catch (error) {
      outcome = { ok: false, error: errorMessage(error) };
    }
    await this.prisma.parserJobRequest
      .update({
        where: { id },
        data: outcome.ok
          ? {
              status: 'DONE',
              finishedAt: new Date(),
              result: toJson(outcome.result),
            }
          : { status: 'FAILED', finishedAt: new Date(), error: outcome.error },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Could not record the outcome of request ${id}: ${errorMessage(error)}`,
        ),
      );
  }

  private async expireUnclaimed() {
    const expired = await this.prisma.parserJobRequest.updateMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - UNCLAIMED_EXPIRY_MS) },
      },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: 'Воркер не забрал заявку вовремя',
      },
    });
    if (expired.count) {
      this.logger.warn(`Dropped ${expired.count} stale parser request(s)`);
    }
  }

  private async pruneFinished() {
    if (Date.now() - this.lastPruneAt < PRUNE_EVERY_MS) return;
    this.lastPruneAt = Date.now();
    await this.prisma.parserJobRequest.deleteMany({
      where: {
        status: { in: ['DONE', 'FAILED'] },
        createdAt: { lt: new Date(Date.now() - KEEP_FINISHED_MS) },
      },
    });
  }
}

function toParams(value: Prisma.JsonValue | null): JobParams | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const limit = Number(value.limit);
  return Number.isFinite(limit) && limit > 0 ? { limit } : undefined;
}

/** Job results are plain counters; anything else is stored as its JSON form. */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    // A circular structure: keep a marker rather than lose the outcome row.
    return '[unserialisable result]';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
