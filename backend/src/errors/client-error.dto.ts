import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** One JavaScript error a visitor's browser hit (plugins/client-errors.client.ts). */
export class ClientErrorDto {
  @IsString()
  @Length(1, 1000)
  message!: string;

  /** TypeError, ChunkLoadError, unhandledrejection, vue… */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  stack?: string;

  /** The page path, without the query (it may carry a token). */
  @IsString()
  @Length(1, 500)
  path!: string;

  /** Script URL and position, for errors that carry them. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  line?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  column?: number;

  /** Nuxt build id: which deploy the visitor's page came from. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  release?: string;
}
