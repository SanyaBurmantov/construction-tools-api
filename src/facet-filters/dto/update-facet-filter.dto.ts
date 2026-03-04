import { PartialType } from '@nestjs/mapped-types';
import { CreateFacetFilterDto } from './create-facet-filter.dto';

export class UpdateFacetFilterDto extends PartialType(CreateFacetFilterDto) {}
