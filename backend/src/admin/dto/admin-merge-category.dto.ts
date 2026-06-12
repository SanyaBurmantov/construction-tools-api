import { IsString, IsNotEmpty } from 'class-validator';

export class AdminMergeCategoryDto {
  @IsString()
  @IsNotEmpty()
  targetCategoryId: string;
}
