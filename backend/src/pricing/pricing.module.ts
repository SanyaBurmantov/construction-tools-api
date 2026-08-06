import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingRulesService } from './pricing-rules.service';

@Module({
  providers: [PricingService, PricingRulesService],
  exports: [PricingService, PricingRulesService],
})
export class PricingModule {}
