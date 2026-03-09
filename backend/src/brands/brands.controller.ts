import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';

@Controller('brands')
export class BrandsController {
  constructor(private service: BrandsService) {}

  @Post()
  create(@Body() dto: CreateBrandDto) {
    return this.service.create(dto);
  }

  @Get()
  getAll() {
    return this.service.findAll();
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.service.findBySlug(slug);
  }
}
