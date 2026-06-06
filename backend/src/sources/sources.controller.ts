import { Controller, Get } from '@nestjs/common';
import { SourcesProductsService, SourcesService } from './sources.service';

@Controller('source-products')
export class SourcesProductsController {
  constructor(private service: SourcesProductsService) {}

  @Get()
  getAll() {
    return this.service.findAll();
  }
}

@Controller('sources')
export class SourceController {
  constructor(private service: SourcesService) {}

  @Get()
  getAll() {
    return this.service.getAll();
  }
}
