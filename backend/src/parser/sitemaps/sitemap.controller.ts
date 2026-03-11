import { Body, Controller, Get, Post } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { ThToolsParserService } from '../sites/th-tools.parser';

@Controller('sitemap-initial')
export class SitemapController {
  constructor(private service: SitemapsService) {
  }

  @Get()
  create() {
    return this.service.parseAllSitemapsThTools();
  }
}
