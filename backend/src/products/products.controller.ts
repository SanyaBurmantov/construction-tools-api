import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product-dto';
import { ProductService } from './products.service';

@Controller('products')
export class ProductController {
  constructor(private service: ProductService) {}

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Get()
  getAll() {
    return this.service.findAll();
  }
}
