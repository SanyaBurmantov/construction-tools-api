import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { CatalogNormalizerService } from './catalog-normalizer.service';
import { SpecNormalizerService } from './spec-normalizer.service';
import { CategoryNormalizerService } from './category-normalizer.service';

/**
 * Admin surface for catalogue normalization: see what the canonical layer
 * currently looks like, preview what a run would change, and run it.
 */
@UseGuards(AdminGuard)
@Controller('admin/catalog/normalize')
export class CatalogNormalizerController {
  constructor(
    private readonly normalizer: CatalogNormalizerService,
    private readonly specs: SpecNormalizerService,
    private readonly categories: CategoryNormalizerService,
  ) {}

  /** Current state: filters, canonical groups, roots, and what is unmapped. */
  @Get()
  getReport() {
    return this.normalizer.getReport();
  }

  /**
   * Runs a full pass. `?dryRun=true` reports what both passes would change
   * without writing anything — the safe way to review a new entry in the
   * taxonomy table before it moves products, and the way to see how many
   * characteristic values the run would delete before it deletes them.
   */
  @Post()
  @HttpCode(200)
  run(@Query('dryRun') dryRun?: string) {
    return this.normalizer.run({ dryRun: dryRun === 'true' });
  }

  /**
   * Characteristics only — the pass that unifies the filters. This is the
   * destructive one (it drops uninformative values and deletes the duplicate
   * `Specification` rows it folds together), so it takes `?dryRun=true` too.
   */
  @Post('specs')
  @HttpCode(200)
  runSpecs(@Query('dryRun') dryRun?: string) {
    return this.specs.normalize(dryRun === 'true');
  }

  /** Categories only — retroactive filters, placeholders, root merges. */
  @Post('categories')
  @HttpCode(200)
  runCategories(@Query('dryRun') dryRun?: string) {
    return this.categories.normalize(dryRun === 'true');
  }
}
