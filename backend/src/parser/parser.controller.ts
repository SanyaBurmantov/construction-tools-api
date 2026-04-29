import { Controller, Get } from '@nestjs/common';
import { ThToolsParserService } from './sites/th-tools.parser';

@Controller('products-from-sitemap-initial')
export class ParserController {
  constructor(private service: ThToolsParserService) {}

  @Get()
  create() {
    return this.service.processSitemapsBatch();
  }
}
