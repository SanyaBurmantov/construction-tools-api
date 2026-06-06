import { PartialType } from '@nestjs/mapped-types';
import { AdminCreateProductDto } from './admin-create-product.dto';

export class AdminUpdateProductDto extends PartialType(AdminCreateProductDto) {}
