import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PricingScope, RoundingMode } from '@prisma/client';

export class AdminCreatePricingRuleDto {
  @ApiProperty({ description: 'Название правила' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ enum: PricingScope, default: PricingScope.GLOBAL })
  @IsOptional()
  @IsEnum(PricingScope)
  scope?: PricingScope;

  @ApiProperty({
    required: false,
    description: 'ID категории (для scope=CATEGORY)',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false, description: 'ID бренда (для scope=BRAND)' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({
    required: false,
    description: 'ID поставщика (для scope=SOURCE)',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({
    required: false,
    description: 'Нижняя граница закупочной цены',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minCost?: number;

  @ApiProperty({
    required: false,
    description: 'Верхняя граница закупочной цены',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxCost?: number;

  @ApiProperty({ description: 'Наценка в процентах' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupPercent?: number;

  @ApiProperty({
    required: false,
    description: 'Фиксированная надбавка сверху',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupFixed?: number;

  @ApiProperty({ required: false, description: 'Минимальная абсолютная маржа' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minMargin?: number;

  @ApiProperty({ enum: RoundingMode, default: RoundingMode.CHARM_90 })
  @IsOptional()
  @IsEnum(RoundingMode)
  rounding?: RoundingMode;

  @ApiProperty({
    required: false,
    description: 'Приоритет при равной специфичности',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}

export class AdminUpdatePricingRuleDto extends AdminCreatePricingRuleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  declare name: string;
}

export class PricingPreviewDto {
  @ApiProperty({ description: 'Закупочная цена' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sourceId?: string;
}

export class PricingRecalculateDto {
  @ApiProperty({ required: false, description: 'Ограничить категорией' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false, description: 'Ограничить брендом' })
  @IsOptional()
  @IsString()
  brandId?: string;
}

export class PricingReviewDto {
  @ApiProperty({
    description:
      'true — принять новую закупочную цену и пересчитать, false — оставить прежнюю цену',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  accept!: boolean;
}
