import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchEventDto {
  @IsIn(['SEARCH', 'CLICK'])
  kind!: 'SEARCH' | 'CLICK';

  @IsString()
  @MaxLength(200)
  term!: string;

  @IsIn(['catalog', 'suggest'])
  source!: 'catalog' | 'suggest';

  /** SEARCH: products found. */
  @IsOptional()
  @IsInt()
  @Min(0)
  results?: number;

  /** CLICK: the product picked… */
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** …and its place in the list, from 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  position?: number;
}
