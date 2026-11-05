import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PlanArea, PlanKind, PlanStatus } from '@prisma/client';
import { PLAN_METRICS } from './plan-metrics';

/** A screenshot already uploaded to our S3 (`POST /admin/media/upload?kind=screenshot`). */
export class PlanAttachmentDto {
  @IsUrl({ protocols: ['https', 'http'], require_tld: false })
  @MaxLength(500)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

const METRIC_KEYS = PLAN_METRICS.map((m) => m.key);

/**
 * Create and update share one shape: every field optional on update, and
 * `null` clears an optional one (an untouched form field sends nothing).
 */
export class PlanItemDto {
  @IsOptional()
  @IsEnum(PlanKind)
  kind?: PlanKind;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 300)
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;

  @IsOptional()
  @IsEnum(PlanArea)
  area?: PlanArea;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  assignee?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(METRIC_KEYS)
  metric?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  target?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  goalId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PlanAttachmentDto)
  attachments?: PlanAttachmentDto[];
}
