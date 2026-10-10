import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';

@ApiTags('Sources')
@Controller('sources')
export class SourceController {
  constructor(private service: SourcesService) {}

  /** Supplier list for the catalogue facet — id, name and code only. */
  @Get()
  getAll() {
    return this.service.getAll();
  }
}
