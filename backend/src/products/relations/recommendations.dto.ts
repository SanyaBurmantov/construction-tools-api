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

export class RecommendationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  accessoriesPage = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  fitsPage = 1;
}

export class RecommendationGroupQueryDto {
  @IsString()
  @Matches(/^[a-z]+:[a-z0-9./-]{1,32}$/)
  key!: string;

  @IsIn(['PART', 'TOOL'])
  role!: 'PART' | 'TOOL';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}

export class CartSuggestionsQueryDto {
  /** Product ids of the cart, comma-separated. */
  @IsString()
  @Matches(/^[0-9a-f-]{36}(?:,[0-9a-f-]{36}){0,49}$/i)
  ids!: string;
}
