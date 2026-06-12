import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductService } from './products.service';
import { ApiTags } from '@nestjs/swagger';
import { ProductFilterDto } from './dto/product-filter-dto';

@ApiTags('Products')
@Controller('products')
export class ProductController {
  constructor(private service: ProductService) {}

  @Get()
  getAll(@Query() filter: ProductFilterDto) {
    return this.service.findAllFiltered(filter);
  }

  // Must precede the ':slug' route so '/products/sitemap' isn't treated as a slug.
  @Get('sitemap')
  getSitemap() {
    return this.service.getSitemapEntries();
  }

  @Get('suggest')
  suggest(@Query('q') q: string) {
    return this.service.suggest(q ?? '');
  }

  @Get(':slug')
  getOne(@Param('slug') slug: string) {
    return this.service.getProductBySlug(slug);
  }
}
