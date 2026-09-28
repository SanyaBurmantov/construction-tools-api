import { PartialType } from '@nestjs/mapped-types';
import { AdminCreateCategoryDto } from './admin-create-category.dto';

export class AdminUpdateCategoryDto extends PartialType(
  AdminCreateCategoryDto,
) {}
