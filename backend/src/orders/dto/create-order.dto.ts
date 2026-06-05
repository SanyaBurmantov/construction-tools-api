import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryMethod, PaymentMethod } from '@prisma/client';

export class CreateOrderItemDto {
  @ApiProperty({ description: 'ID товара' })
  @IsString()
  productId!: string;

  @ApiProperty({ description: 'Количество', minimum: 1, maximum: 999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto], description: 'Позиции заказа' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ description: 'Имя покупателя' })
  @IsString()
  @Length(2, 120)
  customerName!: string;

  @ApiProperty({ description: 'Телефон покупателя' })
  @IsString()
  @Length(5, 32)
  customerPhone!: string;

  @ApiProperty({ required: false, description: 'Email покупателя' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({ required: false, description: 'Комментарий к заказу' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  comment?: string;

  @ApiProperty({ enum: DeliveryMethod, description: 'Способ доставки' })
  @IsEnum(DeliveryMethod)
  deliveryMethod!: DeliveryMethod;

  @ApiProperty({ required: false, description: 'Адрес доставки' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  deliveryAddress?: string;

  @ApiProperty({ enum: PaymentMethod, description: 'Способ оплаты' })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}
