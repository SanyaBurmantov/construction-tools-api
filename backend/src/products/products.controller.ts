import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product-dto';
import { ProductService } from './products.service';
import * as productFilterType from './types/product-filter.type';
import { ApiTags } from '@nestjs/swagger';
import { ProductFilterDto } from './dto/product-filter-dto';

@ApiTags('Products')
@Controller('products')
export class ProductController {
  constructor(private service: ProductService) {}

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Get()
  getAll(@Query() filter: ProductFilterDto) {
    return this.service.findAllFiltered(filter);
  }
}
