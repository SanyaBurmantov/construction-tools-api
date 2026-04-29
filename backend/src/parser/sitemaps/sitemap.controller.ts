import { Controller, Get } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';

@Controller('sitemap-initial')
export class SitemapController {
  constructor(private service: SitemapsService) {}

  @Get()
  create() {
    return this.service.parseAllSitemapsThTools();
  }
}
