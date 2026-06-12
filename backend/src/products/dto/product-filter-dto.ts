import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ProductFilterDto {
  @ApiProperty({ required: false, description: 'Поиск по названию товара' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    required: false,
    description: 'ID категории (включая подкатегории)',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({
    required: false,
    description: 'Slug категории (включая подкатегории)',
  })
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @ApiProperty({
    required: false,
    description: 'ID бренда (несколько — через запятую)',
  })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ required: false, description: 'Только товары в наличии' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  inStock?: boolean;

  @ApiProperty({ required: false, description: 'Код источника' })
  @IsOptional()
  @IsString()
  sourceCode?: string;

  @ApiProperty({ required: false, description: 'Минимальная цена' })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  priceMin?: number;

  @ApiProperty({ required: false, description: 'Максимальная цена' })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  priceMax?: number;

  @ApiProperty({
    required: false,
    description: 'Сортировка',
    enum: ['name', 'price', 'createdAt', 'updatedAt'],
  })
  @IsOptional()
  @IsIn(['name', 'price', 'createdAt', 'updatedAt'])
  @IsString()
  sortBy?: 'name' | 'price' | 'createdAt' | 'updatedAt';

  @ApiProperty({
    required: false,
    description: 'Порядок сортировки',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  @IsString()
  sortOrder?: 'asc' | 'desc';

  @ApiProperty({ required: false, description: 'Номер страницы', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({
    required: false,
    description: 'Количество товаров на странице',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
