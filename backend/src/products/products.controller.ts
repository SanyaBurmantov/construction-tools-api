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

  @Get(':slug')
  getOne(@Param('slug') slug: string) {
    return this.service.getProductBySlug(slug);
  }
}
