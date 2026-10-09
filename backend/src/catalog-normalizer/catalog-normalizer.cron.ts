import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ParserSettingsService } from '../parser/parser-settings.service';
import { CatalogNormalizerService } from './catalog-normalizer.service';

/**
 * Nightly catalogue normalization.
 *
 * 03:40 is deliberately off every parsing slot: the sources process their
 * queues at :10/:20/:40/:50 and refresh at 05:00–06:40, and the watchdog runs
 * at :07/:37. The normalizer rewrites the same tables the parsers write to, so
 * overlapping would mean both fighting for the same rows.
 *
 * Gated on the global parser switch only. A per-source switch makes no sense
 * for a pass over the merged catalogue, but an operator who has turned parsing
 * off is usually mid-investigation and does not want rows moving underneath
 * them either.
 */
@Injectable()
export class CatalogNormalizerCron {
  constructor(
    private readonly settings: ParserSettingsService,
    private readonly normalizer: CatalogNormalizerService,
  ) {}

  @Cron('0 40 3 * * *')
  async normalizeNightly() {
    if (!(await this.settings.isCronEnabled())) return;
    // Fire and forget with an explicit catch: a cron handler that rejects
    // takes the process down on an unhandled rejection, and the run already
    // records its own failure in ParserRuntimeStatus.
    this.normalizer.run().catch(() => undefined);
  }
}
