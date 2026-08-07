import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Query booleans arrive as strings. `@Type(() => Boolean)` would turn "false"
 * into `true`, so parse explicitly — same fix as AdminSitemapQueryDto.
 */
const toBoolean = () =>
  Transform(({ value }) =>
    value === undefined || value === ''
      ? undefined
      : value === 'true' || value === '1' || value === true,
  );

export class ParserCronDto {
  @IsBoolean()
  enabled!: boolean;
}

export class ParserSourceSettingsDto {
  @IsOptional()
  @IsBoolean()
  cronEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  batchLimit?: number;

  /** Politeness: how long to wait between requests to the supplier. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(60000)
  requestDelayMs?: number;

  /** Catalog-crawl / pagination page cap. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxPages?: number;

  // Regex source, validated for compilability in the service — an empty string
  // is a legitimate value meaning "no filter".
  @IsOptional()
  @IsString()
  categoryIncludeRegex?: string;

  @IsOptional()
  @IsString()
  categoryExcludeRegex?: string;
}

export const CATEGORY_QUEUE_STATUSES = [
  'PENDING',
  'DONE',
  'FAILED',
  'SKIPPED',
  'PROBLEM',
  'DISABLED',
] as const;

export class CategoryQueueQueryDto {
  /** Required: the queue is per supplier. Validated against PARSER_SOURCES. */
  @IsString()
  source!: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(CATEGORY_QUEUE_STATUSES)
  status?: (typeof CATEGORY_QUEUE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class CategoryQueueToggleDto {
  @toBoolean()
  @IsBoolean()
  isEnabled!: boolean;
}

export class CategoryQueueProcessDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
