import { Injectable } from '@nestjs/common';
import { ParserJobService } from './parser-job.service';
import { SourceWebsitesService } from '../source-websites/source-websites.service';

export interface ParserJob {
  id: string;
  name: string;
  sitemapUrl: string;
  sourceWebsiteId?: string;
  productPattern?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total?: number;
  success?: number;
  failed?: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  maxDepth?: number;
  concurrency?: number;
  delayMs?: number;
}

@Injectable()
export class ParserJobQueueService {
  private jobs: Map<string, ParserJob> = new Map();
  private runningJobs: Set<string> = new Set();

  constructor(
    private parserJobService: ParserJobService,
    private sourceWebsitesService: SourceWebsitesService,
  ) {}

  /**
   * Создать новую задачу на парсинг
   */
  async createJob(options: {
    name: string;
    sitemapUrl: string;
    sourceWebsiteId?: string;
    productPattern?: string;
    maxDepth?: number;
    concurrency?: number;
    delayMs?: number;
  }): Promise<ParserJob> {
    const jobId = this.generateJobId();
    
    const job: ParserJob = {
      id: jobId,
      name: options.name,
      sitemapUrl: options.sitemapUrl,
      sourceWebsiteId: options.sourceWebsiteId,
      productPattern: options.productPattern,
      status: 'pending',
      maxDepth: options.maxDepth,
      concurrency: options.concurrency,
      delayMs: options.delayMs,
    };

    this.jobs.set(jobId, job);

    // Запускаем задачу асинхронно
    this.runJob(jobId).catch(console.error);

    return job;
  }

  /**
   * Получить статус задачи
   */
  getJobStatus(jobId: string): ParserJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Получить все задачи
   */
  getAllJobs(): ParserJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) =>
        new Date(b.startedAt || 0).getTime() -
        new Date(a.startedAt || 0).getTime(),
    );
  }

  /**
   * Удалить задачу
   */
  deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && job.status === 'running') {
      return false; // Нельзя удалить_running задачу
    }
    return this.jobs.delete(jobId);
  }

  /**
   * Запуск задачи
   */
  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || this.runningJobs.has(jobId)) {
      return;
    }

    this.runningJobs.add(jobId);
    job.status = 'running';
    job.startedAt = new Date();

    try {
      console.log(`Starting job ${jobId}: ${job.name}`);

      const result = await this.parserJobService.parseProductsFromSitemap(
        job.sitemapUrl,
        job.sourceWebsiteId,
        {
          productPattern: job.productPattern,
          maxDepth: job.maxDepth,
          concurrency: job.concurrency,
          delayMs: job.delayMs,
        },
      );

      job.total = result.total;
      job.success = result.success;
      job.failed = result.failed;
      job.status = 'completed';
      job.completedAt = new Date();

      console.log(
        `Job ${jobId} completed: ${result.success} success, ${result.failed} failed`,
      );
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();

      console.error(`Job ${jobId} failed:`, error);
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
