import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductFilterDto {
  @ApiProperty({ required: false, description: 'Поиск по названию товара' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, description: 'ID категории' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false, description: 'ID бренда' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ required: false, description: 'Минимальная цена' })
  @IsOptional()
  @IsNumber()
  priceMin?: number;

  @ApiProperty({ required: false, description: 'Максимальная цена' })
  @IsOptional()
  @IsNumber()
  priceMax?: number;

  @ApiProperty({ required: false, description: 'Сортировка', enum: ['name', 'price'] })
  @IsOptional()
  @IsString()
  sortBy?: 'name' | 'price';

  @ApiProperty({ required: false, description: 'Порядок сортировки', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';

  @ApiProperty({ required: false, description: 'Номер страницы', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, description: 'Количество товаров на странице', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}