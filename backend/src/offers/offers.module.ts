import { Module } from '@nestjs/common';
import { SeoModule } from '../seo/seo.module';
import { OffersService } from './offers.service';
import { ProductMergeService } from './product-merge.service';
import { PricingModule } from '../pricing/pricing.module';
import { OfferSplitService } from './offer-split.service';
import { OfferSplitCron } from './offer-split.cron';

@Module({
  imports: [PricingModule, SeoModule],
  providers: [
    OffersService,
    ProductMergeService,
    OfferSplitService,
    OfferSplitCron,
  ],
  exports: [OffersService, ProductMergeService],
})
export class OffersModule {}
