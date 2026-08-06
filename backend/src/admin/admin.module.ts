import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { SitemapsService } from '../parser/sitemaps/sitemaps.service';
import { ThToolsParserService } from '../parser/sites/th-tools.parser';
import { DukonParserService } from '../parser/sites/dukon.parser';
import { Supplier7745ParserService } from '../parser/sites/7745-source.parser';
import { ToolsByParserService } from '../parser/sites/tools-by-source.parser';
import { ParserLogService } from '../parser/parser-log.service';
import { ParserRuntimeStatusService } from '../parser/parser-runtime-status.service';
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
    SitemapsService,
    ThToolsParserService,
    DukonParserService,
    Supplier7745ParserService,
    ToolsByParserService,
    ParserLogService,
    ParserRuntimeStatusService,
    DataQualityService,
    CategoryMergeService,
    SpecificationsAdminService,
  ],
})
export class AdminModule {}
