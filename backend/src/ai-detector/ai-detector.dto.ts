import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { emptyToUndefined } from '../common/dto/empty-to-undefined';
import { MAX_TEXT_CHARS } from './limits';

/** Either `text` or `url`; when both come, the page wins. */
export class DetectorCheckDto {
  @Transform(emptyToUndefined)
  @ValidateIf((dto: DetectorCheckDto) => !dto.url)
  @IsString({ message: 'Вставьте текст или адрес страницы' })
  // A little over the stored limit: a longer paste is cut, not refused.
  @MaxLength(MAX_TEXT_CHARS * 2)
  text?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;
}

export class DetectorListQueryDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
