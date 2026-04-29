import { PartialType } from '@nestjs/mapped-types';
import { AdminCreateBrandDto } from './admin-create-brand.dto';

export class AdminUpdateBrandDto extends PartialType(AdminCreateBrandDto) {}
