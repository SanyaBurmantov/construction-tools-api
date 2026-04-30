import { IsOptional, IsString } from 'class-validator';

export class AdminMapSourceCategoryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;
}
