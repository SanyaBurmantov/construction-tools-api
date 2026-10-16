import { Injectable, Logger } from '@nestjs/common';
import { ParserRuntimeStatusService } from '../parser/parser-runtime-status.service';
import {
  SpecNormalizerService,
  SpecNormalizeReport,
} from './spec-normalizer.service';
import {
  CategoryNormalizerService,
  CategoryNormalizeReport,
} from './category-normalizer.service';

/** Monitoring key, so a normalizer run shows up in /health/parser. */
export const CATALOG_NORMALIZE_KEY = 'catalog-normalize';
const CATALOG_NORMALIZE_LABEL = 'Нормализовать каталог';

export type CatalogNormalizeReport = {
  /** True when nothing was written and both reports are a preview. */
  dryRun: boolean;
  specs: SpecNormalizeReport;
  categories: CategoryNormalizeReport;
  durationMs: number;
};

/**
 * One pass over the whole catalogue, making it look like one shop rather than
 * three supplier feeds stapled together.
 *
 * The parsers cannot do this. A parser sees one product page at a time and
 * writes what the supplier said; whether `Мощность, Вт` and `Мощность ( Вт )`
 * are the same filter, or whether `Электроинструмент` and
 * `Электроинструменты BULL, MAKITA…` are the same department, are questions
 * that can only be answered with the whole catalogue in view.
 *
 * Runs on a schedule and on demand from the admin. Both go through the same
 * lock, so a nightly run and an impatient operator cannot collide.
 */
@Injectable()
export class CatalogNormalizerService {
  private readonly logger = new Logger(CatalogNormalizerService.name);
  private running: Promise<unknown> | null = null;
  private runningDry = false;

  constructor(
    private readonly specs: SpecNormalizerService,
    private readonly categories: CategoryNormalizerService,
    private readonly status: ParserRuntimeStatusService,
  ) {}

  get isRunning() {
    return this.running !== null;
  }

  /**
   * A normalization pass. Concurrent callers join the run in progress rather
   * than starting a second one — the steps rewrite the same tables, and two
   * passes at once would fight over the same rows for no benefit.
   */
  async run(
    options: { dryRun?: boolean } = {},
  ): Promise<CatalogNormalizeReport> {
    const dryRun = options.dryRun ?? false;
    return this.exclusive(dryRun, `full${dryRun ? ' (dry)' : ''}`, () =>
      this.execute(dryRun),
    );
  }

  /** One pass on its own (admin buttons), under the same lock as `run`. */
  runStep(step: 'specs' | 'categories', dryRun: boolean) {
    return this.exclusive<unknown>(
      dryRun,
      `${step}${dryRun ? ' (dry)' : ''}`,
      () =>
        step === 'specs'
          ? this.specs.normalize(dryRun)
          : this.categories.normalize(dryRun),
    );
  }

  /**
   * Same-mode callers join the run in progress. A *different* mode waits for
   * it and then runs: joining a dry run used to hand the nightly cron a
   * "done" report while nothing had been applied. The single-step endpoints
   * used to bypass the lock altogether.
   */
  private async exclusive<T>(
    dryRun: boolean,
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    while (this.running) {
      if (this.runningDry === dryRun && label.startsWith('full')) {
        this.logger.log('Normalization already running — joining it');
        return this.running as Promise<T>;
      }
      this.logger.log(`Normalization ${label} waits for the run in progress`);
      await this.running.catch(() => undefined);
    }
    this.runningDry = dryRun;
    const promise = task().finally(() => {
      this.running = null;
    });
    this.running = promise;
    return promise;
  }

  private async execute(dryRun: boolean): Promise<CatalogNormalizeReport> {
    const startedAt = Date.now();
    // A dry run writes nothing, so it must not count as the nightly run in
    // health either — only real runs touch ParserRuntimeStatus.
    if (!dryRun) {
      await this.status.start(CATALOG_NORMALIZE_KEY, CATALOG_NORMALIZE_LABEL);
    }

    try {
      // Categories first: it hides filtered-out products and merges
      // categories, which folds specifications together, and the spec pass
      // then normalizes what is actually left.
      //
      // One caveat for a dry run, which writes nothing: the spec preview reads
      // the catalogue as it stands *now*, not as the category pass would have
      // left it. The two passes touch different rows, so the counts are close,
      // but a run that merges categories will fold a few more specifications
      // than its preview promised — never fewer.
      const categories = await this.categories.normalize(dryRun);
      const specs = await this.specs.normalize(dryRun);

      const report: CatalogNormalizeReport = {
        dryRun,
        specs,
        categories,
        durationMs: Date.now() - startedAt,
      };
      if (!dryRun) await this.status.success(CATALOG_NORMALIZE_KEY, report);
      return report;
    } catch (error) {
      if (!dryRun) await this.status.failure(CATALOG_NORMALIZE_KEY, error);
      throw error;
    }
  }

  /** Everything the admin normalization screen shows. */
  async getReport() {
    const [specs, categories] = await Promise.all([
      this.specs.getReport(),
      this.categories.getReport(),
    ]);
    return { running: this.isRunning, specs, categories };
  }
}
