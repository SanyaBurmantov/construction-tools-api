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
  private running: Promise<CatalogNormalizeReport> | null = null;

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
    if (this.running) {
      this.logger.log('Normalization already running — joining it');
      return this.running;
    }

    this.running = this.execute(options.dryRun ?? false).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(dryRun: boolean): Promise<CatalogNormalizeReport> {
    const startedAt = Date.now();
    await this.status.start(CATALOG_NORMALIZE_KEY, CATALOG_NORMALIZE_LABEL);

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
      await this.status.success(CATALOG_NORMALIZE_KEY, report);
      return report;
    } catch (error) {
      await this.status.failure(CATALOG_NORMALIZE_KEY, error);
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
