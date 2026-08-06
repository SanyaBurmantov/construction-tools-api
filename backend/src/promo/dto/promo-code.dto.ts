import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PromoCodeType } from '@prisma/client';

export class ValidatePromoCodeDto {
  @ApiProperty({ description: 'Промокод' })
  @IsString()
  @Length(1, 64)
  code!: string;

  @ApiProperty({ description: 'Сумма товаров в корзине' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  itemsTotal!: number;
}

export class AdminCreatePromoCodeDto {
  @ApiProperty({ description: 'Код (регистр не важен)' })
  @IsString()
  @Length(2, 64)
  code!: string;

  @ApiProperty({ required: false, description: 'Описание для админки' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiProperty({ enum: PromoCodeType, default: PromoCodeType.PERCENT })
  @IsOptional()
  @IsEnum(PromoCodeType)
  type?: PromoCodeType;

  @ApiProperty({ description: 'Процент (0–100) или фиксированная сумма' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value!: number;

  @ApiProperty({ required: false, description: 'Минимальная сумма заказа' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderTotal?: number;

  @ApiProperty({ required: false, description: 'Лимит применений' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiProperty({ required: false, description: 'Начало действия (ISO)' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiProperty({ required: false, description: 'Конец действия (ISO)' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, description: 'Бесплатная доставка' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  freeDelivery?: boolean;
}

export class AdminUpdatePromoCodeDto extends AdminCreatePromoCodeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  declare code: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declare value: number;
}
