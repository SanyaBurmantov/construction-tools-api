import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { OptionalUserId } from '../auth/current-user.decorator';

@ApiTags('Reviews')
@Controller('products/:slug/reviews')
export class ReviewsController {
  constructor(private service: ReviewsService) {}

  @Get()
  list(@Param('slug') slug: string, @Query() query: ReviewQueryDto) {
    return this.service.listForProduct(slug, query);
  }

  /**
   * Far stricter than the global throttle (120/min): writing a review is a
   * human action, so a handful per hour per IP is generous. `@Ip()` resolves to
   * the real client address because main.ts sets `trust proxy` for Caddy.
   */
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @UseGuards(OptionalAuthGuard)
  @Post()
  create(
    @Param('slug') slug: string,
    @Body() dto: CreateReviewDto,
    @Ip() ip: string,
    @OptionalUserId() userId?: string,
  ) {
    return this.service.create(slug, dto, ip, userId);
  }
}
