import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '../cart-limits';

export class CartItemDto {
  @ApiProperty({ description: 'ID товара' })
  @IsString()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

/**
 * The whole cart in one body. An empty array is valid: it is how the client
 * says "the cart is empty now" when the last line is removed.
 */
export class CartItemsDto {
  @ApiProperty({ type: [CartItemDto] })
  @IsArray()
  @ArrayMaxSize(MAX_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];
}
