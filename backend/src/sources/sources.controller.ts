import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';
import { AdminGuard } from '../admin/admin.guard';

@ApiTags('Sources')
@Controller('sources')
export class SourceController {
  constructor(private service: SourcesService) {}

  /**
   * Supplier list for the catalogue facet — id, name and code only, and
   * **admin-only**: which supplier carries what is our business, not the
   * customer's, so the «Поставщик» filter is rendered for an ADMIN session
   * alone (`CatalogView` fetches this only then). The counts in
   * `GET /products` `facets.sources` stay public but are keyed by id, which
   * says nothing without this list.
   */
  @Get()
  @UseGuards(AdminGuard)
  getAll() {
    return this.service.getAll();
  }
}
