import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminSitemapQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * `@Type(() => Boolean)` would call `Boolean('false')`, which is `true` — so
   * "show me the queued URLs" used to return the processed ones. Parse the
   * string explicitly, the same way the public product filters do.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === ''
      ? undefined
      : value === 'true' || value === '1' || value === true,
  )
  @IsBoolean()
  isVisited?: boolean;

  @IsOptional()
  @IsIn(['PENDING', 'DONE', 'FAILED', 'SKIPPED', 'PROBLEM'])
  status?: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'PROBLEM';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
