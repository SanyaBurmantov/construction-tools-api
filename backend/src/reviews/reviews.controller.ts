import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';

@ApiTags('Reviews')
@Controller('products/:slug/reviews')
export class ReviewsController {
  constructor(private service: ReviewsService) {}

  @Get()
  list(@Param('slug') slug: string, @Query() query: ReviewQueryDto) {
    return this.service.listForProduct(slug, query);
  }

  @Post()
  create(@Param('slug') slug: string, @Body() dto: CreateReviewDto) {
    return this.service.create(slug, dto);
  }
}
