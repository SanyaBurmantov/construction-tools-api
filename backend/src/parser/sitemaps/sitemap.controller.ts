import { Controller, Get, UseGuards } from '@nestjs/common';
import { SitemapsService } from './sitemaps.service';
import { AdminGuard } from '../../admin/admin.guard';

@Controller('sitemap-initial')
@UseGuards(AdminGuard)
export class SitemapController {
  constructor(private service: SitemapsService) {}

  @Get()
  create() {
    return this.service.parseAllSitemapsThTools();
  }
}
