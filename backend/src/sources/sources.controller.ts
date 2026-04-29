import { Body, Controller, Get, Post } from '@nestjs/common';
import { SourcesProductsService, SourcesService } from './sources.service';
import { CreateSourceProductDto } from './dto/create-source-product.dto';
import { CreateSourceDto } from './dto/create-source.dto';

@Controller('source-products')
export class SourcesProductsController {
  constructor(private service: SourcesProductsService) {}

  @Post()
  create(@Body() dto: CreateSourceProductDto) {
    return this.service.create(dto);
  }

  @Get()
  getAll() {
    return this.service.findAll();
  }
}

@Controller('sources')
export class SourceController {
  constructor(private service: SourcesService) {}

  @Post()
  create(@Body() dto: CreateSourceDto) {
    return this.service.create(dto);
  }
  @Get()
  getAll() {
    return this.service.getAll();
  }
}
