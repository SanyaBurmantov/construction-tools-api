import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '../cart-limits';

export class ValidateCartItemDto {
  @ApiProperty({ description: 'ID товара' })
  @IsString()
  productId!: string;

  @ApiProperty({
    description: 'Количество',
    minimum: 1,
    maximum: MAX_LINE_QUANTITY,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;

  @ApiProperty({
    required: false,
    description:
      'Цена, которую сейчас показывает клиент. Используется только чтобы ' +
      'отметить расхождение — в расчётах не участвует.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;
}

export class ValidateCartDto {
  @ApiProperty({ type: [ValidateCartItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => ValidateCartItemDto)
  items!: ValidateCartItemDto[];
}
