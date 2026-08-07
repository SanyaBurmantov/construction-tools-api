import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import {
  PARSER_SOURCES,
  ParserSettingsService,
  getParserSource,
} from './parser-settings.service';
import { ParserRuntimeStatusService } from './parser-runtime-status.service';
import { CategoryQueueService } from './categories/category-queue.service';
import { ParserJobsService } from './parser-jobs.service';
import { ThToolsParserService } from './sites/th-tools-source.parser';
import { DukonParserService } from './sites/dukon.parser';
import { ToolsByParserService } from './sites/tools-by-source.parser';
import { Supplier7745ParserService } from './sites/7745-source.parser';
import {
  CategoryQueueProcessDto,
  CategoryQueueQueryDto,
  CategoryQueueToggleDto,
  ParserCronDto,
  ParserSourceSettingsDto,
} from './dto/parser-admin.dto';

/**
 * The control panel behind `/admin/parsing`: is the cron on, is anything
 * actually running, and the two queues (products, categories) per source.
 * Kept out of AdminController, which is already 500 lines of unrelated CRUD.
 */
@UseGuards(AdminGuard)
@Controller('admin/parser')
export class ParserAdminController {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly runtimeStatus: ParserRuntimeStatusService,
    private readonly categoryQueue: CategoryQueueService,
    private readonly jobs: ParserJobsService,
    private readonly thTools: ThToolsParserService,
    private readonly dukon: DukonParserService,
    private readonly toolsBy: ToolsByParserService,
    private readonly supplier7745: Supplier7745ParserService,
  ) {}

  /* -------------------------------------------------------- overview ---- */

  @Get('overview')
  async getOverview() {
    const [settings, health] = await Promise.all([
      this.settings.getOverview(),
      this.runtimeStatus.getHealth(),
    ]);

    const sources = await Promise.all(
      settings.sources.map(async (source) => ({
        ...source,
        products: await this.productQueueStats(source.code),
        categories: source.hasCategoryQueue
          ? await this.categoryQueue.getStats(source.code)
          : null,
        jobs: health.jobs.filter((job) =>
          job.key.startsWith(`${source.code}-`),
        ),
      })),
    );

    const anyRunning = health.jobs.some((job) => job.isRunning);
    return {
      cronEnabled: settings.cronEnabled,
      envCronEnabled: settings.envCronEnabled,
      globalOverriddenInDb: settings.globalOverriddenInDb,
      // What the admin banner reads: "работает" needs both a switch that is on
      // and at least one source doing something (or a recent success).
      isRunning: anyRunning,
      health: { ok: health.ok, maxAgeHours: health.maxAgeHours },
      sources,
    };
  }

  /* -------------------------------------------------------- settings ---- */

  @Patch('cron')
  setCronEnabled(@Body() dto: ParserCronDto) {
    return this.settings.setCronEnabled(dto.enabled);
  }

  @Patch('sources/:code')
  async setSourceSettings(
    @Param('code') code: string,
    @Body() dto: ParserSourceSettingsDto,
  ) {
    this.ensureKnownSource(code);

    if (dto.cronEnabled !== undefined) {
      await this.settings.setSourceCronEnabled(code, dto.cronEnabled);
    }
    if (dto.batchLimit !== undefined) {
      await this.settings.setBatchLimit(code, dto.batchLimit);
    }
    if (dto.requestDelayMs !== undefined) {
      await this.settings.setRequestDelayMs(code, dto.requestDelayMs);
    }
    if (dto.maxPages !== undefined) {
      await this.settings.setMaxPages(code, dto.maxPages);
    }
    if (
      dto.categoryIncludeRegex !== undefined ||
      dto.categoryExcludeRegex !== undefined
    ) {
      await this.settings.setCategoryFilters(code, {
        include: dto.categoryIncludeRegex,
        exclude: dto.categoryExcludeRegex,
      });
    }

    return this.getOverview();
  }

  /* ------------------------------------------------------------ jobs ---- */

  /** What can be launched by hand for this source, and what it is doing now. */
  @Get('sources/:code/jobs')
  async listJobs(@Param('code') code: string) {
    this.ensureKnownSource(code);
    const health = await this.runtimeStatus.getHealth();

    return this.jobs.jobsFor(code).map((job) => {
      const key = `${code}-${job.name}`;
      const status = health.jobs.find((item) => item.key === key) ?? null;

      return {
        name: job.name,
        key,
        label: job.label,
        description: job.description,
        isRunning: this.jobs.isRunning(key) || (status?.isRunning ?? false),
        health: status?.health ?? null,
        lastSuccessAt: status?.lastSuccessAt ?? null,
        lastError: status?.lastError ?? null,
        lastResult: status?.lastResult ?? null,
      };
    });
  }

  /**
   * Starts a job in the background. Answers immediately — a tools.by catalog
   * crawl runs for a quarter of an hour, so the caller polls the job list
   * instead of holding a request open.
   */
  @Post('sources/:code/jobs/:job/run')
  @HttpCode(202)
  runJob(@Param('code') code: string, @Param('job') jobName: string) {
    this.ensureKnownSource(code);
    const result = this.jobs.start(code, jobName);

    if (!result.started && result.reason === 'unknown-job') {
      throw new BadRequestException(
        `Unknown job "${jobName}" for source "${code}"`,
      );
    }

    return result;
  }

  /* -------------------------------------------------- category queue ---- */

  @Get('categories')
  listCategories(@Query() query: CategoryQueueQueryDto) {
    this.ensureKnownSource(query.source);
    return this.categoryQueue.list({ ...query, sourceCode: query.source });
  }

  @Patch('categories/:id')
  toggleCategory(@Param('id') id: string, @Body() dto: CategoryQueueToggleDto) {
    return this.categoryQueue.setEnabled(id, dto.isEnabled);
  }

  @Post('categories/:id/retry')
  @HttpCode(200)
  retryCategory(@Param('id') id: string) {
    return this.categoryQueue.retry(id);
  }

  @Post('sources/:code/categories/refresh')
  @HttpCode(200)
  refreshCategories(@Param('code') code: string) {
    this.ensureKnownSource(code);
    return this.categoryQueue.refresh(code);
  }

  @Post('sources/:code/categories/process')
  @HttpCode(200)
  processCategories(
    @Param('code') code: string,
    @Body() dto: CategoryQueueProcessDto,
  ) {
    this.ensureKnownSource(code);
    return this.categoryQueue.processBatch(code, dto.limit ?? 3);
  }

  @Post('sources/:code/categories/retry-problems')
  @HttpCode(200)
  retryProblemCategories(@Param('code') code: string) {
    this.ensureKnownSource(code);
    return this.categoryQueue.retryProblems(code);
  }

  @Post('sources/:code/categories/reset')
  @HttpCode(200)
  resetCategories(@Param('code') code: string) {
    this.ensureKnownSource(code);
    return this.categoryQueue.resetAll(code);
  }

  /* ----------------------------------------------------------- utils ---- */

  private productQueueStats(code: string) {
    switch (code) {
      case 'th-tools':
        return this.thTools.getQueueStats();
      case 'tools-by':
        return this.toolsBy.getQueueStats();
      case 'dukon':
        return this.dukon.getQueueStats();
      case '7745':
        return this.supplier7745.getQueueStats();
      default:
        throw new BadRequestException(`Unknown parser source: ${code}`);
    }
  }

  private ensureKnownSource(code: string) {
    if (!getParserSource(code)) {
      throw new BadRequestException(
        `Unknown parser source: ${code}. Known: ${PARSER_SOURCES.map((source) => source.code).join(', ')}`,
      );
    }
  }
}
