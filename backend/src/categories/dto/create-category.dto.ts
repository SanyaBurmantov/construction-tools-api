import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Название категории' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'URL-слаг' })
  @IsString()
  slug: string;

  @ApiPropertyOptional({ description: 'ID родительской категории' })
  @IsString()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ description: 'ID источника' })
  @IsString()
  @IsOptional()
  sourceWebsiteId?: string;

  @ApiPropertyOptional({ description: 'Глубина вложенности' })
  @IsInt()
  @IsOptional()
  depth?: number;
}
