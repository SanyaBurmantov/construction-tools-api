import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import type { AuthenticatedRequest } from '../auth/auth-request';
import { ProductService } from './products.service';
import { ApiTags } from '@nestjs/swagger';
import { ProductFilterDto } from './dto/product-filter-dto';
import { isInternalAddress } from '../common/guards/internal-aware-throttler.guard';

@ApiTags('Products')
@Controller('products')
export class ProductController {
  constructor(private service: ProductService) {}

  /**
   * `sourceCode` (which supplier carries what) is internal: it is honoured for
   * an ADMIN session only and silently dropped for everyone else — hiding the
   * facet in the UI was not enough while the public API still filtered by it.
   * The session can only come from the browser's cookie, so the SSR fetch
   * behind cached storefront HTML never has one.
   */
  @UseGuards(OptionalAuthGuard)
  @Get()
  getAll(
    @Query() filter: ProductFilterDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.authUser?.role !== UserRole.ADMIN) {
      filter.sourceCode = undefined;
    }
    return this.service.findAllFiltered(filter);
  }

  /**
   * Every published slug, for the frontend's sitemap. Internal only — the
   * Nuxt server is its one caller, from inside the Docker network — because
   * it is ~9.5 MB per request, and a few in parallel ran the API out of
   * memory (audit 2026-10-30). Anyone else gets the 404 an unknown slug gets.
   * Must precede the ':slug' route so '/products/sitemap' isn't a slug.
   */
  @Get('sitemap')
  async getSitemap(@Req() request: Request, @Res() res: Response) {
    if (!isInternalAddress(request.ip))
      throw new NotFoundException('Product not found');
    res.type('application/json').send(await this.service.getSitemapJson());
  }

  @Get('suggest')
  suggest(@Query('q') q: unknown) {
    // `?q=a&q=b` arrives as an array (Express 5's simple query parser), and
    // `.trim()` on it answered 500 — with an error-log row and an alert.
    return this.service.suggest(typeof q === 'string' ? q : '');
  }

  @Get(':slug')
  getOne(@Param('slug') slug: string) {
    return this.service.getProductBySlug(slug);
  }
}
