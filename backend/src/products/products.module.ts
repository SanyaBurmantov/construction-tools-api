import { Module } from '@nestjs/common';
import { ListingRankService } from './listing-rank.service';
import { FacetsWarmupService } from './facets-warmup.service';
import { ProductService } from './products.service';
import { ProductController } from './products.controller';
import { CompatibilityRefreshService } from './relations/compatibility-refresh.service';
import {
  CartRecommendationsController,
  RecommendationsController,
} from './relations/recommendations.controller';
import { RecommendationsService } from './relations/recommendations.service';
@Module({
  providers: [
    ProductService,
    ListingRankService,
    FacetsWarmupService,
    CompatibilityRefreshService,
    RecommendationsService,
  ],
  controllers: [
    ProductController,
    RecommendationsController,
    CartRecommendationsController,
  ],
  exports: [ProductService],
})
export class ProductsModule {}
