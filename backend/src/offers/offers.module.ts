import { Module } from '@nestjs/common';
import { OffersService } from './offers.service';
import { ProductMergeService } from './product-merge.service';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule],
  providers: [OffersService, ProductMergeService],
  exports: [OffersService, ProductMergeService],
})
export class OffersModule {}
