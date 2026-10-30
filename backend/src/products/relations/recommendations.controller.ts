import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecommendationsQueryDto } from './recommendations.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('Products')
@Controller('products')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get(':slug/recommendations')
  get(@Param('slug') slug: string, @Query() query: RecommendationsQueryDto) {
    return this.recommendations.get(slug, query);
  }
}
