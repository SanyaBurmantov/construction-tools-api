import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class AuditQueryDto {
  @ApiProperty({ required: false, description: 'Фильтр по админу' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ required: false, enum: ['POST', 'PATCH', 'PUT', 'DELETE'] })
  @IsOptional()
  @IsIn(['POST', 'PATCH', 'PUT', 'DELETE', 'post', 'patch', 'put', 'delete'])
  method?: string;

  @ApiProperty({ required: false, description: 'Подстрока пути' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  path?: string;

  @ApiProperty({ required: false, description: 'Только ошибки (4xx/5xx)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  onlyFailures?: boolean;

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
