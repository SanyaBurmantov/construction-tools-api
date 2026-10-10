import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminCreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Tile artwork for the menu and the category grids. */
  @IsOptional()
  @IsString()
  image?: string;

  /**
   * SEO copy. The admin editor has always sent these two; the DTO did not
   * accept them, and `forbidNonWhitelisted` turns an unknown property into a
   * 400 — so every save from `/admin/categories` failed with
   * "property seoTitle should not exist".
   */
  @IsOptional()
  @IsString()
  seoTitle?: string;

  @IsOptional()
  @IsString()
  seoDescription?: string;

  /** Storefront ordering, lowest first. Bounded so a typo can't bury a row. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
