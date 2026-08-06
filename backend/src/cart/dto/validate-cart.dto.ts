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

export class ValidateCartItemDto {
  @ApiProperty({ description: 'ID товара' })
  @IsString()
  productId!: string;

  @ApiProperty({ description: 'Количество', minimum: 1, maximum: 999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
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
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ValidateCartItemDto)
  items!: ValidateCartItemDto[];
}
