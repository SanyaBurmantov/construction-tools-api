import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsObject,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ description: 'Название товара' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'URL-слаг' })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({ description: 'Описание' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Бренд' })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiPropertyOptional({ description: 'Модель' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ description: 'Артикул' })
  @IsString()
  @IsOptional()
  article?: string;

  @ApiPropertyOptional({ description: 'Штрихкод' })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiPropertyOptional({ description: 'Цена' })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ description: 'Валюта', default: 'BYN' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Старая цена' })
  @IsNumber()
  @IsOptional()
  oldPrice?: number;

  @ApiPropertyOptional({ description: 'Скидка в процентах' })
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiPropertyOptional({ description: 'В наличии', default: false })
  @IsBoolean()
  @IsOptional()
  inStock?: boolean;

  @ApiPropertyOptional({ description: 'Количество на складе' })
  @IsNumber()
  @IsOptional()
  stockQuantity?: number;

  @ApiPropertyOptional({ description: 'Текст доступности' })
  @IsString()
  @IsOptional()
  availabilityText?: string;

  @ApiPropertyOptional({ description: 'Вес в кг' })
  @IsNumber()
  @IsOptional()
  weight?: number;

  @ApiPropertyOptional({ description: 'Габариты', example: { length: 10, width: 5, height: 3 } })
  @IsObject()
  @IsOptional()
  dimensions?: Record<string, any>;

  @ApiPropertyOptional({ description: 'ID категории' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'ID источника' })
  @IsString()
  @IsOptional()
  sourceWebsiteId?: string;

  @ApiPropertyOptional({ description: 'URL источника' })
  @IsString()
  @IsOptional()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: 'ID в источнике' })
  @IsString()
  @IsOptional()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Изображения', type: [String] })
  @IsArray()
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ description: 'Главное изображение' })
  @IsString()
  @IsOptional()
  mainImage?: string;

  @ApiPropertyOptional({ description: 'Характеристики', example: { "Мощность": "2200 Вт", "Вес": "5.2 кг" } })
  @IsObject()
  @IsOptional()
  specifications?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Особенности', type: [String] })
  @IsArray()
  @IsOptional()
  features?: string[];

  @ApiPropertyOptional({ description: 'Страна происхождения' })
  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @ApiPropertyOptional({ description: 'Гарантия' })
  @IsString()
  @IsOptional()
  warranty?: string;

  @ApiPropertyOptional({ description: 'Производитель' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ description: 'Активен', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
