import { AiEntity } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { emptyToUndefined } from '../../common/dto/empty-to-undefined';

/**
 * Cap on one task — a guard against spending a paid key on the whole
 * catalogue by one click; a free key does ~250 products a day at batch size 5.
 */
export const MAX_TASK_ITEMS = 5000;

export class AiProductFilterDto {
  @IsOptional()
  @IsString()
  search?: string;

  /** Includes the whole subtree. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Comma-separated. */
  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';

  /** A text field that is empty. */
  @IsOptional()
  @IsIn(['descriptionShort', 'descriptionFull', 'seoTitle', 'seoDescription'])
  missing?: string;

  /** `yes` — already rewritten by AI, `no` — never touched. */
  @IsOptional()
  @IsIn(['yes', 'no'])
  ai?: 'yes' | 'no';

  @IsOptional()
  @IsIn(['in_stock', 'out_of_stock'])
  stock?: string;
}

export class AiCategoryFilterDto {
  @IsOptional()
  @IsString()
  search?: string;

  /** Includes the whole subtree. */
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  level?: number;

  @IsOptional()
  @IsIn(['yes', 'no'])
  visible?: 'yes' | 'no';

  @IsOptional()
  @IsIn(['description'])
  missing?: string;
}

class PageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AiProductQueryDto extends AiProductFilterDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AiCategoryQueryDto extends AiCategoryFilterDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AiTaskListQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(AiEntity)
  entity?: AiEntity;
}

export class AiTaskItemsQueryDto extends PageDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPLIED', 'UNCHANGED', 'FAILED', 'REVERTED'])
  status?: string;
}

export class AiPromptDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEnum(AiEntity)
  entity!: AiEntity;

  @IsString()
  @Length(1, 8000)
  text!: string;
}

export class AiUpdatePromptDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 8000)
  text?: string;
}

export class AiCreateTaskDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsEnum(AiEntity)
  entity!: AiEntity;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  fields!: string[];

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  promptId?: string;

  /**
   * The instruction. With `templates` it is optional and only *added* to the
   * built-in rules and the per-kind guide (`ai-templates.ts`).
   */
  @IsOptional()
  @IsString()
  @Length(0, 8000)
  prompt?: string;

  /** Built-in shop rules + a guide per kind of product (one task per kind). */
  @IsOptional()
  @IsBoolean()
  templates?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(1, 200)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  batchSize?: number;

  /** Empty — start on the next runner tick. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601()
  scheduledAt?: string;

  /** Explicitly picked rows… */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TASK_ITEMS)
  @IsString({ each: true })
  ids?: string[];

  /** …or "everything matching this filter", resolved once at creation. */
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}

export class AiPreviewDto {
  @IsEnum(AiEntity)
  entity!: AiEntity;

  @IsString()
  id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  fields!: string[];

  @IsOptional()
  @IsString()
  @Length(0, 8000)
  prompt?: string;

  @IsOptional()
  @IsBoolean()
  templates?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  model?: string;
}

/** «Объяснить по товару»: no model call, so no model. */
export class AiExplainDto {
  @IsEnum(AiEntity)
  entity!: AiEntity;

  @IsString()
  id!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 8000)
  prompt?: string;
}

export class AiTemplateTextDto {
  /** Empty or null goes back to the code default. */
  @IsOptional()
  @IsString()
  @Length(0, 8000)
  text?: string | null;
}

export class AiRescheduleDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601()
  scheduledAt?: string;
}
