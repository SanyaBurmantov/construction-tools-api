import { Controller, Get, UseGuards } from '@nestjs/common';
import { ThToolsParserService } from './sites/th-tools-source.parser';
import { AdminGuard } from '../admin/admin.guard';

@Controller('products-from-sitemap-initial')
@UseGuards(AdminGuard)
export class ParserController {
  constructor(private service: ThToolsParserService) {}

  @Get()
  create() {
    return this.service.processSitemapsBatch();
  }
}
