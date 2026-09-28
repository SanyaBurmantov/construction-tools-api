import { IsString, IsOptional, IsBoolean, IsInt, IsEnum, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FilterType {
  RANGE = 'RANGE',
  SELECT = 'SELECT',
  BOOLEAN = 'BOOLEAN',
  MULTISELECT = 'MULTISELECT',
}

export class CreateFacetFilterDto {
  @ApiProperty({ description: 'Название фильтра (например, "Цена", "Бренд")' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Поле товара для фильтрации' })
  @IsString()
  field: string;

  @ApiProperty({ enum: FilterType, description: 'Тип фильтра' })
  @IsEnum(FilterType)
  type: FilterType;

  @ApiProperty({ description: 'ID категории' })
  @IsString()
  categoryId: string;

  @ApiPropertyOptional({ description: 'Включен', default: true })
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Порядок сортировки' })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Дополнительная конфигурация', example: { min: 0, max: 100000 } })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}
