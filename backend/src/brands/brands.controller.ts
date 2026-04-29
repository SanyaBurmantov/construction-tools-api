import { Controller, Get } from '@nestjs/common';
import { BrandsService } from './brands.service';

@Controller('brands')
export class BrandsController {
  constructor(private service: BrandsService) {}

  @Get()
  getAll() {
    return this.service.findAll();
  }
}
