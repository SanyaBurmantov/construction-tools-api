import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * 50 pages of 12 is 600 cards, more than any shelf holds. The page numbers
 * are part of the recommendations cache key, and up to 10 000 let anyone mint
 * 10⁸ keys per product, each a fresh computation (audit 2026-10-30).
 */
export const MAX_RECOMMENDATION_PAGE = 50;

export class RecommendationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RECOMMENDATION_PAGE)
  accessoriesPage = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RECOMMENDATION_PAGE)
  fitsPage = 1;
}

export class RecommendationGroupQueryDto {
  @IsString()
  // Values keep their case: «thread:M10», «slot:PH2».
  @Matches(/^[a-z]+:[A-Za-z0-9./-]{1,32}$/)
  key!: string;

  @IsIn(['PART', 'TOOL'])
  role!: 'PART' | 'TOOL';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RECOMMENDATION_PAGE)
  page = 1;
}

export class CartSuggestionsQueryDto {
  /** Product ids of the cart, comma-separated. */
  @IsString()
  @Matches(/^[0-9a-f-]{36}(?:,[0-9a-f-]{36}){0,49}$/i)
  ids!: string;
}
