import { Module } from '@nestjs/common';
import { FacetFiltersService } from './facet-filters.service';
import { FacetFiltersController } from './facet-filters.controller';

@Module({
  controllers: [FacetFiltersController],
  providers: [FacetFiltersService],
  exports: [FacetFiltersService],
})
export class FacetFiltersModule {}
