import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSourceWebsiteDto {
  @ApiProperty({ description: 'Название сайта' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Базовый URL' })
  @IsString()
  baseUrl: string;

  @ApiPropertyOptional({ description: 'Активен', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Конфигурация парсера (CSS-селекторы)',
    example: {
      selectors: {
        name: 'h1',
        price: '.price-value',
        brand: '.brand',
        specifications: {
          container: '.specs tr',
          key: 'td:first-child',
          value: 'td:last-child',
        },
      },
    },
  })
  @IsObject()
  @IsOptional()
  parserConfig?: Record<string, any>;
}
