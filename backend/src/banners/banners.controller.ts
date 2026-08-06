import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BannersService } from './banners.service';

@ApiTags('Banners')
@Controller('banners')
export class BannersController {
  constructor(private service: BannersService) {}

  @Get()
  list() {
    return this.service.listPublic();
  }
}
