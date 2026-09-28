import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class Admin7745SitemapQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['PENDING', 'DONE', 'FAILED', 'SKIPPED', 'PROBLEM'])
  status?: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  limit?: number;
}
