import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ParserModule } from '../parser/parser.module';
import { OrdersModule } from '../orders/orders.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { PromoModule } from '../promo/promo.module';
import { PricingModule } from '../pricing/pricing.module';
import { OffersModule } from '../offers/offers.module';
import { BannersModule } from '../banners/banners.module';
import { DataQualityService } from './data-quality.service';
import { CategoryMergeService } from './category-merge.service';
import { SpecificationsAdminService } from './specifications-admin.service';

@Module({
  imports: [
    // Parser services come from ParserModule — see its `exports`.
    ParserModule,
    OrdersModule,
    ReviewsModule,
    PromoModule,
    PricingModule,
    OffersModule,
    BannersModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminGuard,
    AdminService,
    DataQualityService,
    CategoryMergeService,
    SpecificationsAdminService,
  ],
})
export class AdminModule {}
