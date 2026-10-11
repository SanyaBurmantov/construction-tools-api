import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class ErrorLogQueryDto {
  @ApiProperty({
    required: false,
    enum: ['server', 'client'],
    description: 'server — 5xx, client — 4xx',
  })
  @IsOptional()
  @IsIn(['server', 'client'])
  kind?: 'server' | 'client';

  @ApiProperty({ required: false, description: 'Точный HTTP-код' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(400)
  @Max(599)
  statusCode?: number;

  @ApiProperty({ required: false, description: 'Подстрока пути или текста' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
