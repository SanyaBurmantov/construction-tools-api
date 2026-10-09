import { Module } from '@nestjs/common';
import { ParserModule } from '../parser/parser.module';
import { AdminModule } from '../admin/admin.module';
import { CatalogNormalizerController } from './catalog-normalizer.controller';
import { CatalogNormalizerCron } from './catalog-normalizer.cron';
import { CatalogNormalizerService } from './catalog-normalizer.service';
import { CategoryNormalizerService } from './category-normalizer.service';
import { SpecNormalizerService } from './spec-normalizer.service';

/**
 * The pass that turns three supplier feeds into one catalogue: canonical
 * characteristics (so filters are not duplicated per category and per
 * spelling) and a canonical category tree (so a department is one department
 * whichever supplier named it).
 *
 * `AdminModule` is imported for `CategoryMergeService` — moving products,
 * supplier mappings, pricing rules and child categories onto a surviving
 * category is already solved there, and a second implementation would be one
 * more place to get a redirect or a cascade wrong.
 */
@Module({
  imports: [ParserModule, AdminModule],
  controllers: [CatalogNormalizerController],
  providers: [
    CatalogNormalizerService,
    SpecNormalizerService,
    CategoryNormalizerService,
    CatalogNormalizerCron,
  ],
  exports: [CatalogNormalizerService],
})
export class CatalogNormalizerModule {}
