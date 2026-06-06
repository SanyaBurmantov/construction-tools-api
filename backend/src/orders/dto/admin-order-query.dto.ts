import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class AdminOrderQueryDto {
  @ApiProperty({
    required: false,
    enum: OrderStatus,
    description: 'Статус заказа',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiProperty({
    required: false,
    description: 'Поиск по имени/телефону/email/номеру',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, description: 'Номер страницы', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, description: 'Размер страницы', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminUpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, description: 'Новый статус заказа' })
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
