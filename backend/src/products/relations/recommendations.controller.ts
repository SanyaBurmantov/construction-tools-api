import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CartSuggestionsQueryDto,
  RecommendationGroupQueryDto,
  RecommendationsQueryDto,
} from './recommendations.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('Products')
@Controller('products')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get(':slug/recommendations')
  get(@Param('slug') slug: string, @Query() query: RecommendationsQueryDto) {
    return this.recommendations.get(slug, query);
  }

  @Get(':slug/recommendations/group')
  group(
    @Param('slug') slug: string,
    @Query() query: RecommendationGroupQueryDto,
  ) {
    return this.recommendations.group(slug, query.key, query.role, query.page);
  }
}

/**
 * Not under /products: `GET /products/:slug` would take «cart» for a slug.
 * Public like `POST /cart/validate` — a guest cart needs it too.
 */
@ApiTags('Products')
@Controller('recommendations')
export class CartRecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('cart')
  cart(@Query() query: CartSuggestionsQueryDto) {
    return this.recommendations.forCart(query.ids.split(','));
  }
}
