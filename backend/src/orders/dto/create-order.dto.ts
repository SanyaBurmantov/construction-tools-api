import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryMethod, PaymentMethod } from '@prisma/client';
import { emptyToUndefined } from '../../common/dto/empty-to-undefined';
import {
  IsBankAccount,
  IsBic,
  IsUnp,
} from '../../common/dto/requisites.validators';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '../../cart/cart-limits';
import { AttributionDto } from '../../attribution/attribution.dto';

export class CreateOrderItemDto {
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
}

export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto], description: 'Позиции заказа' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_LINES)
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

  @ApiProperty({
    required: false,
    description:
      'Плательщик — организация. Обязателен вместе с УНП при оплате по счёту; ' +
      'для аккаунта юрлица пустые поля берутся из профиля.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(2, 200)
  payerName?: string;

  @ApiProperty({ required: false, description: 'УНП плательщика' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUnp()
  payerTaxId?: string;

  @ApiProperty({
    required: false,
    description: 'Юридический адрес плательщика',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(5, 300)
  payerAddress?: string;

  @ApiProperty({ required: false, description: 'Расчётный счёт плательщика' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsBankAccount()
  payerAccount?: string;

  @ApiProperty({ required: false, description: 'Банк плательщика' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(2, 200)
  payerBankName?: string;

  @ApiProperty({ required: false, description: 'БИК банка плательщика' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsBic()
  payerBankBic?: string;

  @ApiProperty({ required: false, description: 'Промокод' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  promoCode?: string;

  @ApiProperty({
    required: false,
    description:
      'Сумма товаров, которую видел покупатель. Если она разошлась с ' +
      'актуальной, заказ отклоняется — чтобы цена не менялась молча.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedItemsTotal?: number;

  @ApiProperty({
    required: false,
    type: AttributionDto,
    description:
      'Источник визита (UTM, click id, реферер) — только для отчётов',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttributionDto)
  attribution?: AttributionDto;
}
