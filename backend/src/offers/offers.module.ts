import { Module } from '@nestjs/common';
import { SeoModule } from '../seo/seo.module';
import { OffersService } from './offers.service';
import { ProductMergeService } from './product-merge.service';
import { PricingModule } from '../pricing/pricing.module';
import { OfferSplitService } from './offer-split.service';
import { OfferSplitCron } from './offer-split.cron';
import { AutoMergeCron } from './auto-merge.cron';
import { MergeConflictsService } from './merge-conflicts.service';

@Module({
  imports: [PricingModule, SeoModule],
  providers: [
    OffersService,
    ProductMergeService,
    OfferSplitService,
    OfferSplitCron,
    AutoMergeCron,
    MergeConflictsService,
  ],
  exports: [OffersService, ProductMergeService, MergeConflictsService],
})
export class OffersModule {}
