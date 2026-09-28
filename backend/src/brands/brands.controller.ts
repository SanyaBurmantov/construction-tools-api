import { Controller, Get, Param } from '@nestjs/common';
import { BrandsService } from './brands.service';

@Controller('brands')
export class BrandsController {
  constructor(private service: BrandsService) {}

  @Get()
  getAll() {
    return this.service.findAll();
  }

  @Get(':slug/categories')
  getCategories(@Param('slug') slug: string) {
    return this.service.getCategories(slug);
  }
}
