import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AdminCreateProductDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceValue?: number;

  /** Pre-discount price. Only shown on the storefront when above priceValue. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  oldPrice?: number;

  @IsOptional()
  @IsString()
  priceCurrency?: string;

  @IsOptional()
  @IsString()
  descriptionShort?: string;

  @IsOptional()
  @IsString()
  descriptionFull?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  stockStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockQuantity?: number;

  @IsOptional()
  @IsString()
  seoTitle?: string;

  @IsOptional()
  @IsString()
  seoDescription?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';

  /** Supplier cost. Normally written by the parser, editable for manual items. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number;

  /**
   * MANUAL pins the price so parsing can't overwrite it; AUTO hands the product
   * back to the markup rules.
   */
  @IsOptional()
  @IsIn(['AUTO', 'MANUAL'])
  pricingMode?: 'AUTO' | 'MANUAL';
}
